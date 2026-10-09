import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@vehicle-os/database/testing';
import { schema } from '@vehicle-os/database';
import { claimDue, retryDelayMs, runDue } from './dispatcher';
import { PermanentError, type Job, type JobHandler } from './handlers/index';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('job runner', () => {
  let database: TestDatabase;
  let ran: Job[];
  let fail: Error | null;

  const handlers: Record<string, JobHandler> = {
    work: async (job) => {
      if (fail) throw fail;
      ran.push(job);
    },
  };
  const run = (maxAttempts = 5) => runDue({ db: database.db, log, handlers, maxAttempts });
  const rows = () => database.db.select().from(schema.outboxMessages);

  async function insert(overrides: Partial<typeof schema.outboxMessages.$inferInsert> = {}) {
    const [row] = await database.db
      .insert(schema.outboxMessages)
      .values({
        queue: 'notifications',
        jobName: 'work',
        payload: { planId: 'plan-1' },
        jobKey: 'work:plan-1',
        ...overrides,
      })
      .returning();
    return row!;
  }

  beforeEach(async () => {
    database = await createTestDatabase();
    ran = [];
    fail = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await database.close();
  });

  it('runs a due job with its payload and marks it processed', async () => {
    const row = await insert();

    expect(await run()).toEqual({ completed: 1, failed: 0, deadLettered: 0 });
    expect(ran).toEqual([{ id: row.id, name: 'work', data: { planId: 'plan-1' } }]);
    const [after] = await rows();
    expect(after?.processedAt).toBeInstanceOf(Date);
    expect(after?.attempts).toBe(1);
  });

  it('does nothing when there is nothing due', async () => {
    expect(await run()).toEqual({ completed: 0, failed: 0, deadLettered: 0 });
  });

  // How quiet hours wait: in the outbox, not in a queue.
  it('holds a job until it is due', async () => {
    await insert({ availableAt: new Date(Date.now() + 60 * 60_000) });

    expect((await run()).completed).toBe(0);
    expect(ran).toHaveLength(0);
  });

  // The lease: a claimed row is not due again while it runs, so a second runner skips it.
  it('leases what it claims', async () => {
    await insert();

    expect(await claimDue(database.db, 10)).toHaveLength(1);
    expect(await claimDue(database.db, 10)).toHaveLength(0);
  });

  it('backs a failure off and keeps it pending', async () => {
    await insert();
    fail = new Error('provider blip');

    expect(await run()).toEqual({ completed: 0, failed: 1, deadLettered: 0 });
    const [after] = await rows();
    expect(after?.lastError).toBe('provider blip');
    expect(after?.deadLetteredAt).toBeNull();
    expect(after!.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Not due again until the backoff has passed.
    fail = null;
    expect((await run()).completed).toBe(0);
  });

  it('dead-letters once the retry budget is spent', async () => {
    await insert({ attempts: 4 });
    fail = new Error('still broken');

    expect((await run(5)).deadLettered).toBe(1);
    const [after] = await rows();
    expect(after?.deadLetteredAt).toBeInstanceOf(Date);
  });

  it('dead-letters a permanent failure at once rather than retrying it', async () => {
    await insert();
    fail = new PermanentError('sender domain not verified');

    expect((await run()).deadLettered).toBe(1);
  });

  // A deployment mismatch: parked for a human, never dropped silently.
  it('dead-letters a job no handler knows', async () => {
    await insert({ jobName: 'extract-text' });

    expect((await run()).deadLettered).toBe(1);
    const [after] = await rows();
    expect(after?.lastError).toContain('No handler registered for job "extract-text"');
  });

  it('never picks up a processed or dead-lettered job', async () => {
    await insert({ processedAt: new Date() });
    await insert({ deadLetteredAt: new Date(), attempts: 5 });

    expect((await run()).completed).toBe(0);
    expect(ran).toHaveLength(0);
  });

  it('takes the oldest due first and honours the limit', async () => {
    const early = new Date(Date.now() - 3000);
    await insert({ jobKey: 'second', availableAt: new Date(Date.now() - 1000) });
    await insert({ jobKey: 'first', availableAt: early });

    const [claimed] = await claimDue(database.db, 1);
    expect(claimed?.jobKey).toBe('first');
  });

  it('backs off exponentially', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000]);
  });
});

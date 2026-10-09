import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import { scanForRecalls } from '../src/modules/notifications/application/services/recall-scan';
import { mapRecalls } from '../src/infrastructure/recalls';
import { createTestContext, seedGarageWithVehicle, signUp, type TestContext } from './harness';

describe('recall scan', () => {
  let context: TestContext;
  let aliceId: string;
  const lookups: string[] = [];

  const lookup = async (vehicle: { make: string; model: string; year: number }) => {
    lookups.push(`${vehicle.make} ${vehicle.model} ${vehicle.year}`);
    return mapRecalls({
      results: [
        {
          NHTSACampaignNumber: '21V123000',
          Component: 'AIR BAGS',
          Summary: 'The passenger air bag may not deploy.',
          Remedy: 'Dealers will replace the module.',
        },
      ],
    });
  };

  beforeAll(async () => {
    context = await createTestContext();
    const alice = await signUp(context, 'Alice');
    aliceId = alice.userId;
    await seedGarageWithVehicle(context, alice, 'Recall Garage');
  });

  afterAll(async () => {
    await context.close();
  });

  it('notifies once per campaign, worded as a likelihood', async () => {
    const first = await scanForRecalls(context.database.db, lookup);
    const second = await scanForRecalls(context.database.db, lookup);

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(lookups[0]).toBe('BMW M3 2021');

    const rows = await context.database.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, aliceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notificationType).toBe('RECALL');
    expect(rows[0]!.body).toContain('may be affected');
    expect(rows[0]!.payload).toMatchObject({ campaign: '21V123000', matchedBy: 'MAKE_MODEL_YEAR' });
  });

  it('keeps going when the lookup is unavailable', async () => {
    const result = await scanForRecalls(context.database.db, async () => null);
    expect(result.notified).toBe(0);
  });
});

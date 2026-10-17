import { describe, expect, it } from 'vitest';
import type { AiProviderPort } from '../../infrastructure/ai-port';
import { draftEntry, readEntryDraft } from './draft-entry';

const today = '2026-10-09';

describe('readEntryDraft', () => {
  it('keeps what fits the event contract, in the fuel form’s fields', () => {
    expect(
      readEntryDraft(
        {
          total: '8,450.50',
          currency: 'pkr',
          litres: 31.2149,
          vendor: ' Shell Gulberg ',
          date: '2026-10-07',
          odometer: '128,004',
          work: 'Super unleaded',
        },
        'fuel',
        today,
      ),
    ).toEqual({
      amount: 8450.5,
      currency: 'PKR',
      litres: 31.21,
      provider: 'Shell Gulberg',
      date: '2026-10-07',
      odometer: 128004,
      // A fill-up has no work line: the note stays the person's.
    });
  });

  it('drops a misread rather than correcting it', () => {
    expect(
      readEntryDraft(
        {
          total: -40,
          currency: 'Rupees',
          litres: 90_000,
          date: '2026-10-10',
          odometer: 1e12,
        },
        'fuel',
        today,
      ),
    ).toEqual({});
    // February has no 30th.
    expect(readEntryDraft({ date: '2026-02-30', total: 12 }, 'service', today)).toEqual({
      amount: 12,
    });
  });

  it('reads only the odometer and the day off a dashboard', () => {
    expect(
      readEntryDraft({ odometer: 92_310.4, total: 64.7, vendor: 'BP' }, 'odometer', today),
    ).toEqual({ odometer: 92_310 });
  });
});

describe('draftEntry', () => {
  it('forces the one call, with the vehicle’s currency and unit in the brief', async () => {
    let seen: Parameters<AiProviderPort['generate']>[0] | undefined;
    const provider: AiProviderPort = {
      model: 'test',
      generate(input) {
        seen = input;
        return Promise.resolve({
          text: null,
          calls: [{ name: 'fill_entry', args: { total: 60.1, currency: 'USD', litres: 41 } }],
        });
      },
    };

    const draft = await draftEntry(provider, {
      kind: 'fuel',
      currency: 'USD',
      unit: 'MI',
      attachments: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }],
      today,
    });

    expect(draft).toEqual({ amount: 60.1, currency: 'USD', litres: 41 });
    expect(seen?.force).toBe('fill_entry');
    expect(seen?.system).toContain('USD');
    expect(seen?.system).toContain('MI');
    expect(seen?.messages[0]).toMatchObject({ attachments: [{ mimeType: 'image/jpeg' }] });
  });
});

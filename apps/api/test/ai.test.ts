import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';
import type { AiProviderPort, AiTurn } from '../src/modules/ai/infrastructure/ai-port';

/**
 * A scripted provider. Every test states exactly what the model "decides" to do, so what is
 * under test is the tool layer and the authorization boundary — never a real model, whose
 * choices would make the suite non-deterministic and cost money.
 */
function scriptedProvider() {
  const script: AiTurn[] = [];
  const seen: { system: string; toolNames: string[]; messageCount: number }[] = [];

  const provider: AiProviderPort = {
    model: 'test-model',
    generate({ system, messages, tools }) {
      seen.push({
        system,
        toolNames: tools.map((tool) => tool.name),
        messageCount: messages.length,
      });
      return Promise.resolve(script.shift() ?? { text: 'Out of script.', calls: [] });
    },
  };

  return {
    provider,
    seen,
    /** The last tool results handed back to the model, as the model would see them. */
    say: (...turns: AiTurn[]) => script.push(...turns),
  };
}

describe('ai', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let vehicleId: string;
  let bobVehicleId: string;
  let ai: ReturnType<typeof scriptedProvider>;

  beforeAll(async () => {
    ai = scriptedProvider();
    context = await createTestContext({ ai: ai.provider });
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');

    vehicleId = (await seedGarageWithVehicle(context, alice, 'Alice Garage')).vehicleId;
    bobVehicleId = (await seedGarageWithVehicle(context, bob, 'Bob Garage')).vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const ask = (question: string, vehicleIdArg?: string) =>
    as(context, alice).post('/api/v1/ai/ask', {
      question,
      ...(vehicleIdArg ? { vehicleId: vehicleIdArg } : {}),
    });

  it('reads a line into a vehicle draft, held to the create contract', async () => {
    ai.say({
      text: null,
      calls: [
        {
          name: 'fill_vehicle',
          args: {
            vehicle_type: 'CAR',
            make: 'Porsche',
            model: '911',
            year: 2019,
            odometer: 42000,
            odometer_unit: 'KM',
            specs: { cylinders: 6, hullType: 'planing' },
          },
        },
      ],
    });

    const response = await as(context, alice).post('/api/v1/ai/vehicle-draft', {
      text: '2019 Porsche 911, 42k km',
    });

    expect(response.status).toBe(200);
    expect(ai.seen.at(-1)?.toolNames).toEqual(['fill_vehicle']);
    // A hull is not a car's, so it never reaches the form.
    expect(response.body).toEqual({
      vehicleType: 'CAR',
      make: 'Porsche',
      model: '911',
      year: 2019,
      currentOdometer: 42000,
      odometerUnit: 'KM',
      specs: { cylinders: 6 },
    });
  });

  it('reads a receipt into a quick entry, held to the event contract', async () => {
    ai.say({
      text: null,
      calls: [
        {
          name: 'fill_entry',
          args: { total: '64.70', currency: 'usd', litres: 41.2, vendor: 'BP', work: 'Unleaded' },
        },
      ],
    });

    const response = await as(context, alice).post('/api/v1/ai/entry-draft', {
      kind: 'fuel',
      currency: 'USD',
      attachments: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }],
    });

    expect(response.status).toBe(200);
    expect(ai.seen.at(-1)?.toolNames).toEqual(['fill_entry']);
    // A fill-up has no work line, so the note stays the person's.
    expect(response.body).toEqual({ amount: 64.7, currency: 'USD', litres: 41.2, provider: 'BP' });
  });

  it('refuses a quick entry with no photo to read', async () => {
    const response = await as(context, alice).post('/api/v1/ai/entry-draft', {
      kind: 'fuel',
      attachments: [],
    });
    expect(response.status).toBe(400);
  });

  it('answers straight from the model when it needs no tools', async () => {
    ai.say({ text: 'You have one vehicle on record.', calls: [] });

    const response = await ask('How many vehicles do I have?');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      answer: 'You have one vehicle on record.',
      sources: [],
      model: 'test-model',
    });
  });

  it('runs a tool and reports it as a source', async () => {
    ai.say(
      { text: null, calls: [{ name: 'list_vehicles', args: {} }] },
      { text: 'A 2021 BMW M3.', calls: [] },
    );

    const response = await ask('What do I own?');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      answer: 'A 2021 BMW M3.',
      sources: [{ tool: 'list_vehicles', vehicleId: null }],
    });
  });

  it('records the vehicle a scoped tool answered for', async () => {
    ai.say(
      { text: null, calls: [{ name: 'get_vehicle_costs', args: { vehicle_id: vehicleId } }] },
      { text: 'Nothing recorded against it yet.', calls: [] },
    );

    const response = await ask('What has it cost me?', vehicleId);

    expect((response.body as { sources: unknown[] }).sources).toEqual([
      { tool: 'get_vehicle_costs', vehicleId },
    ]);
  });

  /*
   * The one that matters. A question, a document or a service note can name somebody else's
   * vehicle id; the model has no way to tell. The tool layer does.
   */
  it('refuses a vehicle in a garage the caller does not belong to', async () => {
    ai.say(
      { text: null, calls: [{ name: 'get_vehicle_profile', args: { vehicle_id: bobVehicleId } }] },
      { text: 'I could not find that vehicle in your garages.', calls: [] },
    );

    const response = await ask('Tell me about Bob’s car');

    expect(response.status).toBe(200);
    // No vehicle is attributed, because none was read.
    expect((response.body as { sources: { vehicleId: string | null }[] }).sources).toEqual([
      { tool: 'get_vehicle_profile', vehicleId: null },
    ]);
  });

  it('hands an unknown tool name back to the model instead of failing', async () => {
    ai.say(
      { text: null, calls: [{ name: 'delete_everything', args: {} }] },
      { text: 'I cannot do that.', calls: [] },
    );

    const response = await ask('Delete my records');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ answer: 'I cannot do that.' });
  });

  it('stops after the round limit rather than looping', async () => {
    const call = { text: null, calls: [{ name: 'list_vehicles', args: {} }] };
    ai.say(call, call, call, call, call, call);

    const response = await ask('Keep going forever');

    expect(response.status).toBe(200);
    expect((response.body as { answer: string }).answer).toContain('lookups allowed');
    // Four rounds of one call each, and no fifth.
    expect((response.body as { sources: unknown[] }).sources).toHaveLength(4);
  });

  it('offers the model every tool, and only those tools', async () => {
    ai.say({ text: 'Fine.', calls: [] });
    await ask('Anything');

    expect(ai.seen.at(-1)?.toolNames).toEqual([
      'list_vehicles',
      'get_vehicle_profile',
      'get_vehicle_costs',
      'get_vehicle_timeline',
      'get_attention_required',
    ]);
  });

  it('requires a session', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: 'What do I own?' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a question that is too short to be one', async () => {
    const response = await ask('a');

    expect(response.status).toBe(400);
  });
});

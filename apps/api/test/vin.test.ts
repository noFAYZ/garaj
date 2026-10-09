import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __setVinCache } from '../src/infrastructure/vin';
import { as, createTestContext, signUp, type SignedUpUser, type TestContext } from './harness';

describe('decode VIN', () => {
  let context: TestContext;
  let alice: SignedUpUser;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    // Seeded, never fetched: tests must not reach NHTSA.
    __setVinCache('1HGCM82633A004352', {
      vin: '1HGCM82633A004352',
      make: 'Honda',
      model: 'Accord',
      year: 2003,
      variant: 'EX-V6',
      specs: { cylinders: 6 },
      warning: null,
    });
    __setVinCache('VF1RFB00X12345678', {
      vin: 'VF1RFB00X12345678',
      make: 'Renault',
      model: null,
      year: null,
      variant: null,
      specs: {},
      warning: null,
    });
  });

  afterAll(async () => {
    await context.close();
  });

  const decode = (vin: string) => as(context, alice).post('/api/v1/vehicles/decode-vin', { vin });

  it('returns candidates, normalising spaces and case', async () => {
    const response = await decode('1hgcm8 2633a004352');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ decoded: true, make: 'Honda', year: 2003 });
  });

  it('degrades a make-only answer to "not decoded"', async () => {
    const response = await decode('VF1RFB00X12345678');
    expect(response.body).toMatchObject({ decoded: false, make: 'Renault', model: null });
  });

  it('refuses something that is not a VIN', async () => {
    const response = await decode('NOT-A-VIN-OOOO');
    expect(response.status).toBe(400);
  });
});

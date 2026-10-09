import { describe, expect, it } from 'vitest';
import { AiUnavailableError, type AiProviderPort } from '../../infrastructure/ai-port';
import { lookUpVehicle, readDraft } from './draft-vehicle';

describe('readDraft', () => {
  it('keeps what fits the create contract and drops what does not', () => {
    expect(
      readDraft({
        vehicle_type: 'car',
        make: ' Porsche ',
        model: '911',
        variant: 'Carrera S',
        year: 2019,
        vin: 'wp0 zzz99zts392124',
        registration: 'gt3 rs',
        purchase_date: '2021-03-01',
        purchase_price: 98000,
        purchase_currency: 'usd',
        odometer: '42,150',
        odometer_unit: 'km',
        specs: { cylinders: 6, fuelType: 'GASOLINE', chainSize: '520', powerHp: 99999 },
      }),
    ).toEqual({
      vehicleType: 'CAR',
      make: 'Porsche',
      model: '911',
      variant: 'Carrera S',
      year: 2019,
      identificationNumber: 'WP0ZZZ99ZTS392124',
      registrationIdentifier: 'GT3 RS',
      purchaseDate: '2021-03-01',
      purchasePrice: 98000,
      purchaseCurrency: 'USD',
      currentOdometer: 42150,
      odometerUnit: 'KM',
      // A chain is not a car's, and 99,999 hp is past the field's bound.
      specs: { cylinders: 6, fuelType: 'GASOLINE' },
    });
  });

  it('reads nothing from nothing, and no specs without a type', () => {
    expect(readDraft({})).toEqual({ specs: {} });
    expect(
      readDraft({
        vehicle_type: 'SPACESHIP',
        year: 3000,
        purchase_date: '2021-02-30',
        specs: { cylinders: 6 },
      }),
    ).toEqual({ specs: {} });
  });

  it('looks specs up without search when search is refused, and stops asking for a while', async () => {
    const searched: boolean[] = [];
    const provider: AiProviderPort = {
      model: 'test',
      generate({ search }) {
        searched.push(Boolean(search));
        if (search) return Promise.reject(new AiUnavailableError('429: no grounding quota'));
        return Promise.resolve({
          text: null,
          calls: [{ name: 'fill_specs', args: { cylinders: 4, hullType: 'planing' } }],
        });
      },
    };
    const corolla = { vehicleType: 'CAR', make: 'Toyota', model: 'Corolla' } as const;

    expect(await lookUpVehicle(provider, corolla)).toEqual({
      specs: { cylinders: 4 },
      sources: [],
    });
    await lookUpVehicle(provider, corolla);
    // Refused once, then straight to the knowledge-only turn.
    expect(searched).toEqual([true, false, false]);
  });
});

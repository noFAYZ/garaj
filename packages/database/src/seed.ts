/**
 * Demo data (Architecture.md §67): one garage, four vehicles, and enough history on each that every
 * screen has something real to show — maintenance due and overdue, tasks, events, expenses, fuel,
 * valuations and a condition assessment.
 *
 *   pnpm db:seed          (with the API running: `pnpm dev`)
 *
 * It goes through the API rather than inserting rows. Next-due dates, health scores, odometer
 * readings, the timeline entry every expense writes — all of that is computed by the API, and a
 * seed that inserted rows directly would have to re-implement it and would drift from it.
 *
 * Deterministic in content, relative in time: the same vehicles and records every run, dated back
 * from today, so "due soon" is still due soon next month. Re-running replaces the demo garage.
 *
 * Signs in as a fixed demo account, created on first run.
 */

import { loadEnvFile } from '@vehicle-os/config';

loadEnvFile();

const DEMO = { email: 'demo@garaj.app', password: 'GarajDemo-2026!', name: 'Demo Driver' };
const GARAGE_NAME = 'Demo Garage';
const USD = 'USD';

const apiOrigin = process.env.AUTH_URL ?? 'http://localhost:3001';
const webOrigin = process.env.WEB_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------------------------
// Time: everything is "so many days ago", from today.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const dateOnly = (days: number) => daysAgo(days).slice(0, 10);
const inDays = (days: number) => dateOnly(-days);
const usd = (dollars: number) => Math.round(dollars * 100);

// ---------------------------------------------------------------------------------------------
// HTTP

let token = '';

async function request<T = { id: string }>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: {
      // Only with a body: Fastify rejects a JSON content type on an empty DELETE.
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      // Better Auth only accepts auth calls from a trusted origin.
      Origin: webOrigin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

const api = (path: string) => `/api/v1${path}`;

async function signIn() {
  try {
    const result = await request<{ token: string }>('POST', '/api/auth/sign-in/email', {
      email: DEMO.email,
      password: DEMO.password,
    });
    token = result.token;
  } catch {
    const result = await request<{ token: string }>('POST', '/api/auth/sign-up/email', DEMO);
    token = result.token;
    console.warn(`created ${DEMO.email}`);
  }
  if (!token)
    throw new Error('Signed in, but no bearer token came back — is the bearer plugin on?');
}

// ---------------------------------------------------------------------------------------------
// One vehicle's history, oldest first. The API rejects an odometer reading lower than the one
// before it, so the order here is the order it is sent in.

type Entry =
  | { at: number; kind: 'event'; body: Record<string, unknown> }
  | { at: number; kind: 'expense'; body: Record<string, unknown> }
  | { at: number; kind: 'repair'; body: Record<string, unknown> };

async function recordHistory(vehicleId: string, entries: Entry[]) {
  const ordered = [...entries].sort((a, b) => b.at - a.at);
  for (const entry of ordered) {
    const occurredAt = daysAgo(entry.at);
    if (entry.kind === 'event') {
      await request('POST', api(`/vehicles/${vehicleId}/events`), { occurredAt, ...entry.body });
    } else if (entry.kind === 'expense') {
      // An expense writes its own timeline entry; recording an event too would show it twice.
      await request('POST', api(`/vehicles/${vehicleId}/expenses`), {
        occurredAt,
        currency: USD,
        ...entry.body,
      });
    } else {
      await request('POST', api(`/vehicles/${vehicleId}/maintenance/records`), {
        performedAt: occurredAt,
        costCurrency: USD,
        ...entry.body,
      });
    }
  }
}

const fuel = (
  at: number,
  odometer: number,
  litres: number,
  dollars: number,
  vendor = 'Shell',
): Entry => ({
  at,
  kind: 'expense',
  body: {
    category: 'FUEL',
    description: 'Fill-up',
    vendor,
    amountMinor: usd(dollars),
    odometer,
    odometerUnit: 'KM',
    quantity: litres.toFixed(1),
    quantityUnit: 'LITER',
    isFullTank: true,
  },
});

// ---------------------------------------------------------------------------------------------

async function resetGarage(): Promise<string> {
  const garages = await request<{ id: string; name: string }[]>('GET', api('/garages'));
  for (const garage of garages.filter((row) => row.name === GARAGE_NAME)) {
    await request('DELETE', api(`/garages/${garage.id}`));
    console.warn(`removed previous ${GARAGE_NAME}`);
  }
  const garage = await request('POST', api('/garages'), {
    name: GARAGE_NAME,
    description: 'Seeded demo data — safe to delete',
  });
  return garage.id;
}

async function dailyDriver(garageId: string) {
  const car = await request('POST', api('/vehicles'), {
    garageId,
    vehicleType: 'CAR',
    nickname: 'Daily Driver',
    make: 'Toyota',
    model: 'Corolla',
    variant: '1.8 Hybrid',
    year: 2019,
    color: 'Silver',
    registrationIdentifier: 'GJ19 DRV',
    purchaseDate: dateOnly(1650),
    purchasePriceAmountMinor: usd(17_500),
    purchasePriceCurrency: USD,
  });

  await recordHistory(car.id, [
    {
      at: 1650,
      kind: 'event',
      body: {
        eventType: 'PURCHASE',
        title: 'Bought from Lakeside Toyota',
        odometer: 41_200,
        odometerUnit: 'KM',
        costAmountMinor: usd(17_500),
        costCurrency: USD,
        provider: 'Lakeside Toyota',
      },
    },
    {
      at: 1280,
      kind: 'repair',
      body: {
        title: 'Front brake pads and discs',
        odometer: 58_900,
        odometerUnit: 'KM',
        provider: 'QuickFit Garage',
        workPerformed: 'Replaced front pads and discs; bled brake fluid.',
        partsCostAmountMinor: usd(210),
        laborCostAmountMinor: usd(140),
      },
    },
    {
      at: 720,
      kind: 'event',
      body: {
        eventType: 'INSPECTION',
        title: 'Annual safety inspection — passed',
        odometer: 74_300,
        odometerUnit: 'KM',
        provider: 'City Test Centre',
        costAmountMinor: usd(55),
        costCurrency: USD,
      },
    },
    {
      at: 400,
      kind: 'expense',
      body: {
        category: 'INSURANCE',
        description: 'Annual insurance renewal',
        vendor: 'Harbor Mutual',
        amountMinor: usd(890),
      },
    },
    {
      at: 210,
      kind: 'expense',
      body: {
        category: 'PART',
        description: 'All-season tyres ×4',
        vendor: 'TyreHub',
        amountMinor: usd(520),
        odometer: 86_400,
        odometerUnit: 'KM',
      },
    },
    fuel(150, 88_100, 38.2, 61.4),
    fuel(120, 88_950, 36.7, 58.9),
    fuel(90, 89_820, 39.1, 63.2, 'BP'),
    fuel(60, 90_640, 37.4, 60.1),
    fuel(31, 91_480, 38.8, 64.7),
    {
      at: 20,
      kind: 'event',
      body: {
        eventType: 'CLEANING',
        title: 'Full valet',
        provider: 'Sparkle Wash',
        costAmountMinor: usd(45),
        costCurrency: USD,
      },
    },
    fuel(4, 92_310, 36.2, 59.8, 'BP'),
  ]);

  // Oil: last done ~5 months ago, so it is comfortably current after being completed below.
  const oil = await request('POST', api(`/vehicles/${car.id}/maintenance`), {
    title: 'Engine oil and filter',
    priority: 'MEDIUM',
    intervalDistance: 10_000,
    intervalDistanceUnit: 'KM',
    intervalMonths: 12,
    lastPerformedAt: daysAgo(520),
    lastPerformedOdometer: 78_100,
  });
  await request('POST', api(`/vehicles/${car.id}/maintenance/${oil.id}/complete`), {
    performedAt: daysAgo(150),
    odometer: 88_100,
    odometerUnit: 'KM',
    provider: 'QuickFit Garage',
    workPerformed: '0W-20 synthetic, new filter, topped up washer fluid.',
    partsCostAmountMinor: usd(48),
    laborCostAmountMinor: usd(60),
    costCurrency: USD,
  });
  // Tyre rotation: ~9,500 km since the last one, on a 10,000 km interval — due soon.
  await request('POST', api(`/vehicles/${car.id}/maintenance`), {
    title: 'Rotate tyres',
    priority: 'LOW',
    intervalDistance: 10_000,
    intervalDistanceUnit: 'KM',
    lastPerformedAt: daysAgo(330),
    lastPerformedOdometer: 82_800,
  });
  // Brake fluid: two-year interval, last changed 26 months ago — overdue.
  await request('POST', api(`/vehicles/${car.id}/maintenance`), {
    title: 'Brake fluid change',
    priority: 'HIGH',
    intervalMonths: 24,
    lastPerformedAt: daysAgo(790),
    lastPerformedOdometer: 71_000,
  });

  await request('POST', api(`/vehicles/${car.id}/valuations`), {
    amountMinor: usd(15_800),
    currency: USD,
    valuationDate: dateOnly(700),
    source: 'MARKET_DATA',
    confidence: 70,
  });
  await request('POST', api(`/vehicles/${car.id}/valuations`), {
    amountMinor: usd(14_200),
    currency: USD,
    valuationDate: dateOnly(30),
    source: 'DEALER',
    confidence: 80,
    notes: 'Trade-in quote',
  });

  await request('POST', api(`/vehicles/${car.id}/condition`), {
    assessedAt: daysAgo(25),
    odometer: 91_480,
    odometerUnit: 'KM',
    notes: 'Good daily condition; small chip on the bonnet.',
    items: [
      { category: 'EXTERIOR', score: 78, notes: 'Stone chip on bonnet' },
      { category: 'INTERIOR', score: 86 },
      { category: 'MECHANICAL', score: 90 },
      { category: 'TIRES', score: 92, notes: 'Fitted 7 months ago' },
      { category: 'BRAKES', score: 70, notes: 'Fluid change overdue' },
    ],
  });

  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: car.id,
    title: 'Renew registration',
    category: 'ADMINISTRATIVE',
    priority: 'HIGH',
    dueDate: inDays(9),
    estimatedCostAmountMinor: usd(180),
    costCurrency: USD,
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: car.id,
    title: 'Replace wiper blades',
    category: 'MAINTENANCE',
    priority: 'LOW',
    dueDate: inDays(21),
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: car.id,
    title: 'Book brake fluid change',
    category: 'MAINTENANCE',
    priority: 'URGENT',
    status: 'IN_PROGRESS',
    dueDate: dateOnly(3),
  });
}

async function motorcycle(garageId: string) {
  const bike = await request('POST', api('/vehicles'), {
    garageId,
    vehicleType: 'MOTORCYCLE',
    nickname: 'Weekend Bike',
    make: 'Honda',
    model: 'CB650R',
    year: 2021,
    color: 'Candy Red',
    registrationIdentifier: 'GJ21 MTR',
    purchaseDate: dateOnly(900),
    purchasePriceAmountMinor: usd(8_900),
    purchasePriceCurrency: USD,
  });

  await recordHistory(bike.id, [
    {
      at: 900,
      kind: 'event',
      body: {
        eventType: 'PURCHASE',
        title: 'Bought used, one owner',
        odometer: 3_400,
        odometerUnit: 'KM',
        costAmountMinor: usd(8_900),
        costCurrency: USD,
      },
    },
    {
      at: 600,
      kind: 'expense',
      body: {
        category: 'ACCESSORY',
        description: 'Tail tidy and tank pad',
        vendor: 'MotoParts Direct',
        amountMinor: usd(135),
        odometer: 7_900,
        odometerUnit: 'KM',
      },
    },
    {
      at: 420,
      kind: 'event',
      body: {
        eventType: 'TRIP',
        title: 'Coast road weekend — 640 km',
        odometer: 11_200,
        odometerUnit: 'KM',
      },
    },
    {
      at: 300,
      kind: 'expense',
      body: {
        category: 'STORAGE',
        description: 'Winter storage',
        vendor: 'SafeStore',
        amountMinor: usd(240),
      },
    },
    fuel(95, 13_050, 14.1, 26.3),
    fuel(62, 13_390, 13.6, 25.1),
    fuel(18, 13_760, 14.4, 27.0, 'Esso'),
  ]);

  await request('POST', api(`/vehicles/${bike.id}/maintenance`), {
    title: 'Clean and lube chain',
    priority: 'MEDIUM',
    intervalDistance: 800,
    intervalDistanceUnit: 'KM',
    lastPerformedAt: daysAgo(70),
    lastPerformedOdometer: 13_050,
  });
  const service = await request('POST', api(`/vehicles/${bike.id}/maintenance`), {
    title: 'Annual service',
    priority: 'MEDIUM',
    intervalDistance: 12_000,
    intervalDistanceUnit: 'KM',
    intervalMonths: 12,
    lastPerformedAt: daysAgo(700),
    lastPerformedOdometer: 5_800,
  });
  await request('POST', api(`/vehicles/${bike.id}/maintenance/${service.id}/complete`), {
    performedAt: daysAgo(250),
    odometer: 12_100,
    odometerUnit: 'KM',
    provider: 'Honda Moto Centre',
    workPerformed: 'Oil and filter, valve check, brake fluid.',
    partsCostAmountMinor: usd(95),
    laborCostAmountMinor: usd(180),
    costCurrency: USD,
  });

  await request('POST', api(`/vehicles/${bike.id}/valuations`), {
    amountMinor: usd(7_400),
    currency: USD,
    valuationDate: dateOnly(60),
    source: 'MARKETPLACE',
    confidence: 60,
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: bike.id,
    title: 'Fit new chain and sprockets',
    category: 'MAINTENANCE',
    priority: 'MEDIUM',
    dueOdometer: 16_000,
    estimatedCostAmountMinor: usd(260),
    costCurrency: USD,
  });
}

async function bicycle(garageId: string) {
  const cycle = await request('POST', api('/vehicles'), {
    garageId,
    vehicleType: 'BICYCLE',
    nickname: 'Gravel Bike',
    make: 'Trek',
    model: 'Checkpoint ALR 5',
    year: 2022,
    color: 'Matte Olive',
    purchaseDate: dateOnly(700),
    purchasePriceAmountMinor: usd(2_100),
    purchasePriceCurrency: USD,
  });

  await recordHistory(cycle.id, [
    {
      at: 700,
      kind: 'event',
      body: {
        eventType: 'PURCHASE',
        title: 'Bought new',
        odometer: 0,
        odometerUnit: 'KM',
        costAmountMinor: usd(2_100),
        costCurrency: USD,
        provider: 'Pedal Works',
      },
    },
    {
      at: 380,
      kind: 'expense',
      body: {
        category: 'PART',
        description: 'Tubeless conversion kit',
        vendor: 'Pedal Works',
        amountMinor: usd(85),
        odometer: 2_300,
        odometerUnit: 'KM',
      },
    },
    {
      at: 120,
      kind: 'repair',
      body: {
        title: 'New chain and cassette',
        odometer: 4_100,
        odometerUnit: 'KM',
        provider: 'Pedal Works',
        partsCostAmountMinor: usd(120),
        laborCostAmountMinor: usd(30),
      },
    },
    {
      at: 14,
      kind: 'event',
      body: {
        eventType: 'TRIP',
        title: 'Gravel loop — 82 km',
        odometer: 4_950,
        odometerUnit: 'KM',
      },
    },
  ]);

  await request('POST', api(`/vehicles/${cycle.id}/maintenance`), {
    title: 'Replace chain',
    priority: 'LOW',
    intervalDistance: 3_000,
    intervalDistanceUnit: 'KM',
    lastPerformedAt: daysAgo(120),
    lastPerformedOdometer: 4_100,
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: cycle.id,
    title: 'Bleed hydraulic brakes',
    category: 'MAINTENANCE',
    priority: 'MEDIUM',
    dueDate: inDays(30),
  });
}

async function projectCar(garageId: string) {
  const mx5 = await request('POST', api('/vehicles'), {
    garageId,
    vehicleType: 'CAR',
    nickname: 'Project Vehicle',
    make: 'Mazda',
    model: 'MX-5',
    variant: 'NA 1.6',
    year: 1991,
    color: 'Mariner Blue',
    registrationIdentifier: 'H91 NAB',
    purchaseDate: dateOnly(540),
    purchasePriceAmountMinor: usd(4_200),
    purchasePriceCurrency: USD,
  });

  await recordHistory(mx5.id, [
    {
      at: 540,
      kind: 'event',
      body: {
        eventType: 'PURCHASE',
        title: 'Bought as a restoration project',
        odometer: 184_000,
        odometerUnit: 'KM',
        costAmountMinor: usd(4_200),
        costCurrency: USD,
        description: 'Runs, needs rust work and a timing belt.',
      },
    },
    {
      at: 500,
      kind: 'repair',
      body: {
        title: 'Timing belt and water pump',
        odometer: 184_050,
        odometerUnit: 'KM',
        provider: 'Roadster Specialists',
        partsCostAmountMinor: usd(310),
        laborCostAmountMinor: usd(420),
      },
    },
    {
      at: 360,
      kind: 'expense',
      body: {
        category: 'REPAIR',
        description: 'Sill rust repair and paint',
        vendor: 'Classic Body Shop',
        amountMinor: usd(1_650),
        odometer: 184_600,
        odometerUnit: 'KM',
      },
    },
    {
      at: 240,
      kind: 'event',
      body: {
        eventType: 'MODIFICATION',
        title: 'Coilovers fitted',
        odometer: 185_200,
        odometerUnit: 'KM',
        costAmountMinor: usd(890),
        costCurrency: USD,
        description: 'Adjustable coilovers, alignment done.',
      },
    },
    {
      at: 90,
      kind: 'expense',
      body: {
        category: 'MODIFICATION',
        description: 'Hardtop, refurbished',
        vendor: 'Roadster Salvage',
        amountMinor: usd(600),
      },
    },
    {
      at: 40,
      kind: 'event',
      body: {
        eventType: 'NOTE',
        title: 'Clutch feels heavy — investigate',
        odometer: 186_020,
        odometerUnit: 'KM',
      },
    },
  ]);

  await request('POST', api(`/vehicles/${mx5.id}/maintenance`), {
    title: 'Engine oil and filter',
    priority: 'MEDIUM',
    intervalDistance: 5_000,
    intervalDistanceUnit: 'KM',
    intervalMonths: 6,
    lastPerformedAt: daysAgo(230),
    lastPerformedOdometer: 185_200,
  });

  await request('POST', api(`/vehicles/${mx5.id}/valuations`), {
    amountMinor: usd(7_500),
    currency: USD,
    valuationDate: dateOnly(45),
    source: 'APPRAISAL',
    confidence: 65,
    notes: 'Agreed value for classic insurance',
  });
  await request('POST', api(`/vehicles/${mx5.id}/condition`), {
    assessedAt: daysAgo(45),
    notes: 'Solid project; interior is the weak spot.',
    items: [
      { category: 'BODY', score: 72, notes: 'Sills repaired' },
      { category: 'INTERIOR', score: 48, notes: 'Seats torn, carpet worn' },
      { category: 'MECHANICAL', score: 66, notes: 'Clutch heavy' },
      { category: 'ELECTRICAL', score: 58, notes: 'Pop-up headlight motor slow' },
    ],
  });

  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: mx5.id,
    title: 'Replace clutch master cylinder',
    category: 'REPAIR',
    priority: 'HIGH',
    dueDate: inDays(14),
    estimatedCostAmountMinor: usd(240),
    costCurrency: USD,
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: mx5.id,
    title: 'Retrim seats in tan leather',
    category: 'IDEA',
    priority: 'LOW',
    estimatedCostAmountMinor: usd(1_400),
    costCurrency: USD,
  });
  await request('POST', api('/tasks'), {
    garageId,
    vehicleId: mx5.id,
    title: 'Source a period-correct steering wheel',
    category: 'RESEARCH',
    priority: 'LOW',
  });
}

async function main() {
  // Any answer at all means it is up; only a refused connection means it is not.
  await fetch(apiOrigin).catch(() => {
    throw new Error(
      `The API is not answering at ${apiOrigin}. Start it with \`pnpm dev\`, then run the seed again.`,
    );
  });
  await signIn();
  const garageId = await resetGarage();
  await dailyDriver(garageId);
  await motorcycle(garageId);
  await bicycle(garageId);
  await projectCar(garageId);
  console.warn(`Seeded ${GARAGE_NAME}: 4 vehicles. Sign in as ${DEMO.email} / ${DEMO.password}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

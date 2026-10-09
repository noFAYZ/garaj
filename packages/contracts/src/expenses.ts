import { Type, type Static } from '@sinclair/typebox';
import { FUEL_TYPES, QUANTITY_UNITS, VOLUME_UNITS } from '@vehicle-os/domain';
import {
  CurrencyCode,
  DistanceUnit,
  ExpenseCategorySchema,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  PaginationQuery,
  Uuid,
} from './common';

/**
 * Fuel and charging detail.
 *
 * Kept as strings on the wire, not numbers: `quantity` is `numeric(12,4)` in the database
 * precisely so litres do not accumulate binary float error across a year of fill-ups, and
 * serialising it as a JSON number puts that error straight back in.
 */
export const VolumeUnit = Type.Union(VOLUME_UNITS.map((unit) => Type.Literal(unit)));

/**
 * What a fill was measured in: litres, kilowatt-hours or kilograms (GAPS §11).
 *
 * Wider than `VolumeUnit`, and deliberately one field rather than three — a fill has one
 * quantity, and the unit is what says how to read it. An electric car records `KWH` here the
 * same way a diesel records `LITER`, which is what lets one logbook hold both.
 */
export const QuantityUnit = Type.Union(QUANTITY_UNITS.map((unit) => Type.Literal(unit)));

/** What was bought. Absent on an expense that is not a fill-up, and on one recorded before. */
export const FuelType = Type.Union(FUEL_TYPES.map((fuel) => Type.Literal(fuel)));

export const Expense = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  /** Set when the expense came from a timeline entry — a logged service, say. */
  eventId: Nullable(Uuid),

  category: ExpenseCategorySchema,
  description: Type.String(),
  vendor: Nullable(Type.String()),

  amount: MoneyOutput,

  occurredAt: IsoDateTime,
  odometer: Nullable(Type.Integer()),
  odometerUnit: Nullable(DistanceUnit),

  fuelType: Nullable(FuelType),
  quantity: Nullable(Type.String()),
  quantityUnit: Nullable(QuantityUnit),
  /**
   * Where it was bought (GAPS §15) — both or neither, never half.
   *
   * Recorded so "have I filled up here before" and "which of these two is cheaper" can be
   * answered about *places* rather than about whatever someone typed in the vendor box, which
   * is "Shell" on one row and "shell a12" on the next.
   */
  latitude: Nullable(Type.Number()),
  longitude: Nullable(Type.Number()),

  energyKwh: Nullable(Type.String()),
  isFullTank: Nullable(Type.Boolean()),

  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Expense = Static<typeof Expense>;

export const CreateExpense = Type.Object(
  {
    category: ExpenseCategorySchema,
    description: Type.String({ minLength: 1, maxLength: 500 }),
    vendor: Type.Optional(Type.String({ maxLength: 200 })),

    // Both required: an expense with no amount is not an expense, and an amount with no
    // currency cannot be added to anything.
    amountMinor: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    currency: CurrencyCode,

    occurredAt: IsoDateTime,
    odometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    odometerUnit: Type.Optional(DistanceUnit),

    fuelType: Type.Optional(FuelType),
    quantity: Type.Optional(Type.String({ maxLength: 20 })),
    quantityUnit: Type.Optional(QuantityUnit),
    /** Both or neither: a latitude alone is a number nothing can use. */
    latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
    longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),

    energyKwh: Type.Optional(Type.String({ maxLength: 20 })),
    isFullTank: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CreateExpense = Static<typeof CreateExpense>;

export const UpdateExpense = Type.Object(
  {
    category: Type.Optional(ExpenseCategorySchema),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    vendor: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    amountMinor: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    currency: Type.Optional(CurrencyCode),
    occurredAt: Type.Optional(IsoDateTime),
    odometer: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000_000 }))),
    odometerUnit: Type.Optional(DistanceUnit),
    fuelType: Type.Optional(Nullable(FuelType)),
    quantity: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
    quantityUnit: Type.Optional(QuantityUnit),
    /** Both or neither: a latitude alone is a number nothing can use. */
    latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
    longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),

    energyKwh: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
    isFullTank: Type.Optional(Nullable(Type.Boolean())),
  },
  { additionalProperties: false },
);
export type UpdateExpense = Static<typeof UpdateExpense>;

export const ListExpensesQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    category: Type.Optional(ExpenseCategorySchema),
    from: Type.Optional(IsoDateTime),
    to: Type.Optional(IsoDateTime),
  }),
]);
export type ListExpensesQuery = Static<typeof ListExpensesQuery>;

export const ExpenseParams = Type.Object({ vehicleId: Uuid, expenseId: Uuid });

export const CategoryTotal = Type.Object({
  category: ExpenseCategorySchema,
  amountMinor: Type.Integer(),
  count: Type.Integer(),
});

/**
 * Fuel consumption by the full-to-full method: everything poured in between two full tanks,
 * over the distance between their odometer readings. Null until two full tanks with readings
 * exist — an average over one measurement is a guess.
 *
 * Both unit pairs are quoted because which one a reader expects follows the vehicle, not
 * the data, and deriving the other one in the browser is arithmetic with a unit conversion
 * in it.
 */
export const FuelConsumption = Type.Object({
  litersPer100Km: Type.Number(),
  milesPerUsGallon: Type.Number(),
  /** Distance the average is built on, in the vehicle's unit. */
  distanceCovered: Type.Number(),
  liters: Type.Number(),
  /** How many full-to-full pairs it averages. */
  segments: Type.Integer(),
});
export type FuelConsumption = Static<typeof FuelConsumption>;

/**
 * Consumption per fuel the vehicle actually took (GAPS §11, §19).
 *
 * One entry per fuel type, never an average across them: a plug-in hybrid's petrol and its
 * electricity are two measurements of the same journey, and adding a litre to a kilowatt-hour
 * produces a figure in no unit at all.
 *
 * `basis` says how it was measured, because the two methods are not equally strong.
 * `FULL_TO_FULL` closes a known quantity between two full tanks. `SPAN` divides everything
 * put in by the distance it was put in across — the only method a battery admits, since
 * nobody charges to full and a charger reports what it delivered, not what the pack holds.
 */
export const FuelUsage = Type.Object({
  /** Null on rows that never said — an old entry, or a plain "Fuel" expense. */
  fuelType: Nullable(FuelType),
  family: Type.Union([Type.Literal('VOLUME'), Type.Literal('ENERGY'), Type.Literal('MASS')]),
  unit: QuantityUnit,
  quantity: Type.Number(),
  distanceCovered: Type.Number(),
  distanceUnit: DistanceUnit,
  /** Units of this fuel per 100 km: litres, kilowatt-hours or kilograms. */
  per100Km: Type.Number(),
  /** Distance per unit — how an EV is read (km/kWh, mi/kWh) and a tank in mpg. */
  distancePerUnit: Type.Number(),
  basis: Type.Union([Type.Literal('FULL_TO_FULL'), Type.Literal('SPAN')]),
  /** Fills behind the figure. One is an anecdote, and a client can say so. */
  fills: Type.Integer(),
});
export type FuelUsage = Static<typeof FuelUsage>;

/**
 * What a vehicle has cost (PRD §18, Architecture.md §27).
 *
 * Every figure is computed server-side and in one currency — the vehicle's, which is its
 * purchase currency where it has one and otherwise whichever currency it has been billed in
 * most. Anything spent in another currency stays out of those figures and is reported
 * separately in `otherCurrencies`, in the currency it was actually paid in.
 *
 * `otherCurrenciesConverted` is what that spend comes to at today's rate, offered as an
 * aside rather than folded in: the stated totals remain reproducible from the stored rows
 * alone, and the rate's date travels with the figure so a reader can check it.
 */
export const CostSummary = Type.Object({
  vehicleId: Uuid,
  currency: CurrencyCode,

  /** Everything billed in the window, including the purchase if it falls inside it. */
  totalSpent: MoneyOutput,
  byCategory: Type.Array(CategoryTotal),

  /*
   * Lifetime figures, unaffected by the window: "what has this vehicle cost me" is not a
   * question about the last 90 days.
   */
  purchasePrice: Nullable(MoneyOutput),
  /** Purchase price plus every non-`PURCHASE` expense ever recorded. */
  ownershipCost: MoneyOutput,
  /** Ownership cost per year since the purchase date. Null without one. */
  costPerYear: Nullable(MoneyOutput),

  /**
   * Running cost per unit of distance: spend excluding the purchase, over the distance
   * covered between the first and last odometer readings on record. Null until there are
   * two readings — the odometer at purchase is not stored, so an unused vehicle's
   * `currentOdometer` says nothing about how far it has been driven under this owner.
   */
  costPerDistance: Nullable(MoneyOutput),
  distanceCovered: Nullable(Type.Integer()),
  distanceUnit: DistanceUnit,

  /** Lifetime fuel consumption, ignoring the window. Null without two full tanks. */
  fuelConsumption: Nullable(FuelConsumption),

  /**
   * The same question answered for every fuel this vehicle takes, including the ones no tank
   * method can reach. Empty until something was recorded with both a quantity and a reading.
   */
  usage: Type.Array(FuelUsage),

  /** Sums per currency for everything the figures above had to exclude. */
  otherCurrencies: Type.Array(
    Type.Object({ currency: CurrencyCode, amountMinor: Type.Integer(), count: Type.Integer() }),
  ),
  /**
   * That same spend at today's rate, in `currency`. Null when there is none, when rates
   * could not be fetched, or when a currency is missing from the table — an approximation
   * that cannot be made is absent, never silently zero.
   */
  otherCurrenciesConverted: Nullable(MoneyOutput),
  /** When the rates behind `otherCurrenciesConverted` were published. */
  ratesAsOf: Nullable(IsoDateTime),
  /**
   * True when the garage reports in one currency (`costReporting: CONVERTED`) and the figures
   * above already include `otherCurrencies`, converted at the rates of `ratesAsOf`. False means
   * the figures are strict — the stored rows in `currency` alone. A garage set to convert still
   * gets strict figures, and `false` here, when rates could not be had.
   */
  includesConverted: Type.Boolean(),
});
export type CostSummary = Static<typeof CostSummary>;

/**
 * Spend per calendar month, for the chart on the Costs tab.
 *
 * Every month in the window is present, including the ones with nothing in them — a series
 * drawn from only the months that had expenses puts January next to July and reports a quiet
 * summer as a busy one. `PURCHASE` is excluded for the same reason it is excluded from every
 * other running-cost figure: one bar an order of magnitude above the rest flattens the others
 * into the axis.
 */
/**
 * Set on a figure quoted for a garage that reports in one currency (`costReporting:
 * CONVERTED`): true when spend in other currencies is folded in, at the rates published on
 * `ratesAsOf`. False — with `ratesAsOf` null — means strict: only rows paid in `currency`.
 */
const Conversion = {
  includesConverted: Type.Boolean(),
  ratesAsOf: Nullable(IsoDateTime),
};

export const MonthlySpend = Type.Object({
  currency: CurrencyCode,
  ...Conversion,
  points: Type.Array(
    Type.Object({
      /** `YYYY-MM`, UTC — the same bucketing the rows were grouped by. */
      month: Type.String(),
      amountMinor: Type.Integer(),
    }),
  ),
});
export type MonthlySpend = Static<typeof MonthlySpend>;

export const MonthlySpendQuery = Type.Object({
  months: Type.Optional(Type.Integer({ minimum: 2, maximum: 60 })),
});

export const CostSummaryQuery = Type.Object({
  from: Type.Optional(IsoDateTime),
  to: Type.Optional(IsoDateTime),
});
export type CostSummaryQuery = Static<typeof CostSummaryQuery>;

/**
 * What fuel has cost per litre (GAPS §5), derived from each fill's amount and quantity.
 *
 * Decimal strings in major units, three places — "1.759" — as a pump shows it. Only fills in
 * `currency` (the cost summary's own) are included; a price in another currency next to these
 * would chart exchange rates, not fuel.
 */
/**
 * How a vehicle has behaved over time, rather than averaged flat (GAPS §12, §13).
 *
 * Three series in one response, because they are read together and come from the same handful
 * of rows: is it drinking more than it used to, what has it cost by now, and how hard is it
 * actually used. The same "one request for one screen" rule the dashboard follows (§27).
 */
export const CostTrends = Type.Object({
  currency: CurrencyCode,
  distanceUnit: DistanceUnit,

  /**
   * Consumption per measurable step, one series per fuel. A plug-in hybrid has two lines and
   * they are never averaged — a litre and a kilowatt-hour do not add up to anything.
   */
  efficiency: Type.Array(
    Type.Object({
      fuelType: Nullable(FuelType),
      unit: QuantityUnit,
      points: Type.Array(
        Type.Object({
          occurredAt: IsoDateTime,
          distanceCovered: Type.Number(),
          quantity: Type.Number(),
          per100Km: Type.Number(),
          distancePerUnit: Type.Number(),
        }),
      ),
    }),
  ),

  /**
   * What it had cost by the end of each month, the purchase included from the month it was
   * bought. Quiet months are drawn as zeros rather than skipped.
   */
  ownership: Type.Array(
    Type.Object({
      month: Type.String(),
      spentMinor: Type.Integer(),
      cumulativeMinor: Type.Integer(),
    }),
  ),

  /**
   * Distance per calendar year, apportioned by days across the gap each reading closes — a
   * reading in March measures driving that mostly happened last year.
   */
  distancePerYear: Type.Array(
    Type.Object({ year: Type.Integer(), distance: Type.Integer(), distanceUnit: DistanceUnit }),
  ),
});
export type CostTrends = Static<typeof CostTrends>;

export const FuelPrices = Type.Object({
  currency: CurrencyCode,
  ...Conversion,
  /**
   * What these prices are per — litre, kilowatt-hour or kilogram (GAPS §11).
   *
   * One series per unit, because "what fuel costs" has two answers on a plug-in hybrid and
   * averaging a pump price with a charging tariff gives a number in no unit at all.
   */
  unit: QuantityUnit,
  /** Quantity-weighted over every fill in this unit's family. Null until there is one. */
  averagePerUnit: Nullable(Type.String()),
  points: Type.Array(
    Type.Object({
      occurredAt: IsoDateTime,
      perUnit: Type.String(),
      vendor: Nullable(Type.String()),
    }),
  ),
  /** Cheapest first; only places with two fills or more — one fill is an anecdote. */
  stations: Type.Array(
    Type.Object({
      vendor: Type.String(),
      averagePerUnit: Type.String(),
      fills: Type.Integer(),
    }),
  ),
});
export type FuelPrices = Static<typeof FuelPrices>;

/**
 * Stable domain enumerations (Architecture.md §16).
 *
 * These are declared as const tuples rather than TS `enum` so the runtime array is
 * available for validation and for building Postgres enums and TypeBox schemas from a
 * single source. Adding a member here is the only place a new value should be introduced.
 */

export const VEHICLE_TYPES = [
  'CAR',
  'MOTORCYCLE',
  'SCOOTER',
  'BICYCLE',
  'BOAT',
  'ATV',
  'TRAILER',
  'VAN',
  'RV',
  'OTHER',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['ACTIVE', 'STORED', 'SOLD', 'ARCHIVED'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const GARAGE_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'DRIVER', 'VIEWER'] as const;
export type GarageRole = (typeof GARAGE_ROLES)[number];

/** Timeline entries (Architecture.md §20). A product history record, not an event-sourcing event. */
export const EVENT_TYPES = [
  'PURCHASE',
  'MAINTENANCE',
  'REPAIR',
  'MODIFICATION',
  'INSPECTION',
  'ACCIDENT',
  'FUEL',
  'CHARGE',
  'CLEANING',
  'REGISTRATION',
  'INSURANCE',
  'TRIP',
  'EXPENSE',
  'NOTE',
  'VALUATION',
  'CONDITION_CHECK',
  'DOCUMENT_ADDED',
  'PART_INSTALLED',
  'PART_REMOVED',
  'SALE',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Why a trip was taken, for mileage claims (GAPS §6).
 *
 * Commute is its own member because most tax regimes treat it as neither business nor
 * deductible, and folding it into either would put it on the wrong side of the report.
 */
export const TRIP_PURPOSES = ['BUSINESS', 'PERSONAL', 'COMMUTE'] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

/** Where a record came from. Keeps AI/OCR output distinguishable from user-entered fact (§43). */
export const RECORD_SOURCES = ['USER', 'IMPORT', 'OCR', 'AI', 'TELEMETRY', 'PROVIDER'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  'MAINTENANCE',
  'REPAIR',
  'ADMINISTRATIVE',
  'PURCHASE',
  'MODIFICATION',
  'CLEANING',
  'INSPECTION',
  'RESEARCH',
  'IDEA',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const IDEA_STATUSES = [
  'IDEA',
  'RESEARCH',
  'PLANNED',
  'ORDERED',
  'INSTALLED',
  'ABANDONED',
] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  'PURCHASE',
  'MAINTENANCE',
  'REPAIR',
  'FUEL',
  'CHARGING',
  'INSURANCE',
  'REGISTRATION',
  'TAX',
  'MODIFICATION',
  'PART',
  'ACCESSORY',
  'STORAGE',
  'CLEANING',
  'TRANSPORT',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * What a vehicle earned, for the people whose vehicle is their work (GAPS §14).
 *
 * A separate list from `EXPENSE_CATEGORIES`, and a separate table behind it. Income folded in
 * as a negative expense would have to be excluded by every cost query ever written, and the
 * one that forgot would report a driver's best month as their cheapest — a figure they would
 * take to an accountant.
 *
 * `REIMBURSEMENT` is money back rather than money earned — a warranty claim, a split fare, an
 * employer's mileage payment. It is income to the vehicle either way, and naming it keeps it
 * out of the fares a tax return has to declare.
 */
export const INCOME_CATEGORIES = [
  'FARE',
  'DELIVERY',
  'RENTAL',
  'HAULAGE',
  'REIMBURSEMENT',
  'SALE',
  'OTHER',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const DOCUMENT_TYPES = [
  'REGISTRATION',
  'INSURANCE',
  'PURCHASE_AGREEMENT',
  'SERVICE_INVOICE',
  'REPAIR_INVOICE',
  'INSPECTION_REPORT',
  'WARRANTY',
  'MANUAL',
  'RECEIPT',
  'IMPORT_DOCUMENT',
  'MODIFICATION_CERTIFICATE',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const CONDITION_CATEGORIES = [
  'EXTERIOR',
  'INTERIOR',
  'MECHANICAL',
  'ELECTRICAL',
  'TIRES',
  'BRAKES',
  'BODY',
  'FRAME',
  'OTHER',
] as const;
export type ConditionCategory = (typeof CONDITION_CATEGORIES)[number];

/**
 * Where a valuation came from (Architecture.md §34).
 *
 * Recorded because the sources differ in how much they should be trusted: an owner's guess
 * and a dealer's written offer are not the same evidence, and a figure shown without saying
 * which it was is a figure presented as fact.
 */
export const VALUATION_SOURCES = [
  'USER_ESTIMATE',
  'DEALER',
  'MARKET_DATA',
  'INSURANCE',
  'APPRAISAL',
  'MARKETPLACE',
  'OTHER',
] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];

/**
 * What a share link grants (Architecture.md §35).
 *
 * One member today, and deliberately an enum rather than a set of permissions: a share link
 * is a named, reviewable thing an owner hands to a stranger, not a general-purpose ACL that
 * can be assembled into a shape nobody anticipated.
 */
export const SHARE_SCOPES = ['VEHICLE_PASSPORT'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

/**
 * The parts of a passport an owner chooses to include (PRD §1531: an export contains only
 * what was selected for sharing).
 *
 * Identity, mileage, ownership length and the health score are always present — a passport
 * without them is not a passport. Everything that says something about the owner's money, the
 * car's paperwork or its exact identity is opt-in per link, because the link a buyer gets and
 * the link a mechanic gets are not the same disclosure.
 */
export const PASSPORT_SECTIONS = [
  'IDENTIFICATION_NUMBER',
  'MAINTENANCE',
  'MAINTENANCE_COSTS',
  'CONDITION',
  'DOCUMENTS',
  'FINANCES',
] as const;
export type PassportSection = (typeof PASSPORT_SECTIONS)[number];

/**
 * What goes into a vehicle, and what is bought at the pump.
 *
 * One list for both jobs, which is why the electric members are split by charging speed and
 * DEF is here at all: a spec select asks what a vehicle takes, a fill-up asks what was paid
 * for, and the two answers are the same word often enough that a second list would drift.
 */
export const FUEL_TYPES = [
  'GASOLINE',
  'DIESEL',
  'LPG',
  'CNG',
  'ELECTRIC_SLOW',
  'ELECTRIC_FAST',
  'DEF',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const DISTANCE_UNITS = ['KM', 'MI'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

export const VOLUME_UNITS = ['LITER', 'US_GALLON', 'IMP_GALLON'] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];

/**
 * Energy, for what a charge put in (GAPS §11).
 *
 * One member, and still an enum: it keeps the shape of every other unit family, so the code
 * that asks "which family is this" has no special case, and a second member — should anyone
 * ever want MJ — is a tuple edit rather than a type change across three packages.
 */
export const ENERGY_UNITS = ['KWH'] as const;
export type EnergyUnit = (typeof ENERGY_UNITS)[number];

/** Mass, for the fuels sold by weight: CNG and hydrogen. */
export const MASS_UNITS = ['KG'] as const;
export type MassUnit = (typeof MASS_UNITS)[number];

/**
 * Everything a fill can be measured in.
 *
 * One enum on the column rather than three nullable ones, because a fill has exactly one
 * quantity and the unit is what says how to read it. Which family a unit belongs to is a
 * function (`unitFamily`), not a second column that could disagree with it — a litre in the
 * energy column is a row nothing can interpret and nothing would reject.
 *
 * Volume first, so a `VolumeUnit` is assignable and every existing reader keeps working.
 */
export const QUANTITY_UNITS = [...VOLUME_UNITS, ...ENERGY_UNITS, ...MASS_UNITS] as const;
export type QuantityUnit = (typeof QUANTITY_UNITS)[number];

/**
 * How a garage's cost figures treat spend in other currencies (GAPS §7).
 *
 * `STRICT` reports only what was paid in the summary's currency and lists the rest beside it —
 * reproducible from the stored rows alone. `CONVERTED` folds the rest in at the latest rate,
 * and says which rate and when. Strict is the default: a total nobody can reproduce is worse
 * than one that admits what it left out.
 */
export const COST_REPORTING_MODES = ['STRICT', 'CONVERTED'] as const;
export type CostReportingMode = (typeof COST_REPORTING_MODES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'MAINTENANCE_DUE',
  'MAINTENANCE_OVERDUE',
  'TASK_DUE',
  'TASK_OVERDUE',
  'DOCUMENT_EXPIRING',
  'REGISTRATION_EXPIRING',
  'INSURANCE_EXPIRING',
  'WARRANTY_EXPIRING',
  'HEALTH_CHANGED',
  'GARAGE_BRIEFING',
  'MEMBER_INVITED',
  // A safety recall that may apply, matched by make, model and year — a likelihood, not a
  // finding, and every notification of this type is worded as one.
  'RECALL',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What a person is using the product for.
 *
 * Not a permission and not a price: a personal owner and a business one see different
 * *surfaces* — a sole trader wants a purpose on every trip and an income line on a job, and
 * someone tracking one family car does not want either in the way. What each may actually
 * reach is decided by their plan, in `plans.ts`.
 */
export const ACCOUNT_KINDS = ['PERSONAL', 'BUSINESS'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** What has been paid for. Ordered cheapest first; `PLAN_RANK` in `plans.ts` depends on it. */
export const PLAN_TIERS = ['FREE', 'PLUS', 'BUSINESS'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/**
 * Where a subscription stands with the payment provider.
 *
 * `PAST_DUE` is deliberately not `CANCELED`: a failed card is usually a card, not a decision,
 * so the plan keeps its entitlements through the provider's retry window and the product asks
 * rather than locks. What that window is belongs to the provider, not to this enum.
 */
export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

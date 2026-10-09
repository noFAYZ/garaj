/**
 * Building a vehicle passport (PRD §23, Architecture.md §35).
 *
 * Assembled from an explicit allowlist. Every field here was chosen to be shown to a stranger
 * holding a link, and the omissions are deliberate — see the contract's comment for what is
 * left out and why. The rule while editing this file: nothing is added because it happens to
 * be on the row.
 */

import { and, asc, eq, isNull, isNotNull, notInArray } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import type { VehiclePassport } from '@vehicle-os/contracts';
import type { PassportSection } from '@vehicle-os/domain';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { computeNextDue } from '../../../maintenance/domain/next-due';
import { listPlans } from '../../../maintenance/infrastructure/repositories/maintenance-repository';
import {
  freshStandings,
  latestByCategory,
  overallScore,
} from '../../../condition/domain/condition';
import { computeHealth } from '../../../health/domain/health';

function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()),
  );
}

export async function buildPassport(
  db: Database,
  vehicleId: string,
  /**
   * What the link was made to disclose. Required: there is no "everything" default here, so
   * a caller cannot forget to pass the link's choice and publish the lot (PRD §1531).
   */
  sections: readonly PassportSection[],
  now: Date = new Date(),
): Promise<VehiclePassport | null> {
  const include = new Set(sections);

  const [vehicle] = await db
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), isNull(schema.vehicles.deletedAt)))
    .limit(1);
  if (!vehicle) return null;

  const [records, conditionRows, documents, expenses, valuationRows, plans, tasks, expiring] =
    await Promise.all([
      db
        .select()
        .from(schema.maintenanceRecords)
        .where(eq(schema.maintenanceRecords.vehicleId, vehicleId))
        .orderBy(asc(schema.maintenanceRecords.performedAt)),
      db
        .select({
          category: schema.conditionItems.category,
          score: schema.conditionItems.score,
          assessedAt: schema.conditionAssessments.assessedAt,
        })
        .from(schema.conditionItems)
        .innerJoin(
          schema.conditionAssessments,
          eq(schema.conditionAssessments.id, schema.conditionItems.assessmentId),
        )
        .where(eq(schema.conditionAssessments.vehicleId, vehicleId)),
      db
        .select({
          documentType: schema.documents.documentType,
          title: schema.documents.title,
          issuedOn: schema.documents.issuedOn,
          expiresOn: schema.documents.expiresOn,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.vehicleId, vehicleId),
            isNull(schema.documents.deletedAt),
            isNotNull(schema.documents.uploadedAt),
          ),
        ),
      db
        .select({
          amountMinor: schema.expenses.amountMinor,
          currency: schema.expenses.currency,
          category: schema.expenses.category,
        })
        .from(schema.expenses)
        .where(eq(schema.expenses.vehicleId, vehicleId)),
      db
        .select({
          amountMinor: schema.valuations.estimatedValueAmountMinor,
          currency: schema.valuations.estimatedValueCurrency,
          valuationDate: schema.valuations.valuationDate,
        })
        .from(schema.valuations)
        .where(eq(schema.valuations.vehicleId, vehicleId))
        .orderBy(asc(schema.valuations.valuationDate)),
      listPlans(db, vehicleId, false),
      db
        .select({
          title: schema.tasks.title,
          dueDate: schema.tasks.dueDate,
          priority: schema.tasks.priority,
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.vehicleId, vehicleId),
            isNull(schema.tasks.deletedAt),
            notInArray(schema.tasks.status, ['COMPLETED', 'CANCELLED']),
          ),
        ),
      db
        .select({ title: schema.documents.title, expiresOn: schema.documents.expiresOn })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.vehicleId, vehicleId),
            isNull(schema.documents.deletedAt),
            isNotNull(schema.documents.expiresOn),
            isNotNull(schema.documents.uploadedAt),
          ),
        ),
    ]);

  const standings = latestByCategory(conditionRows, now);
  const today = now.toISOString().slice(0, 10);

  const health = computeHealth({
    plans: plans.map((plan) => ({
      title: plan.title,
      status: computeNextDue(plan, vehicle, now).status,
    })),
    tasks,
    documents: expiring.map((row) => ({ title: row.title, expiresOn: row.expiresOn! })),
    condition: freshStandings(standings).map((standing) => ({
      category: standing.category,
      score: standing.score!,
      ageDays: standing.ageDays,
    })),
    today,
  });

  const purchasePrice =
    vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency
      ? { amountMinor: vehicle.purchasePriceAmountMinor, currency: vehicle.purchasePriceCurrency }
      : null;

  /*
   * Total invested: the purchase plus running spend, in the purchase currency only. Anything
   * billed in another currency is left out rather than converted at a rate this application
   * invented — the same rule the cost summary follows.
   */
  const runningInPurchaseCurrency = purchasePrice
    ? expenses.filter(
        (expense) => expense.category !== 'PURCHASE' && expense.currency === purchasePrice.currency,
      )
    : [];
  const totalInvested = purchasePrice
    ? {
        amountMinor:
          purchasePrice.amountMinor +
          runningInPurchaseCurrency.reduce((total, expense) => total + expense.amountMinor, 0),
        currency: purchasePrice.currency,
      }
    : null;

  const latestValuation = valuationRows.at(-1) ?? null;

  return {
    vehicle: {
      displayName: displayName(vehicle),
      vehicleType: vehicle.vehicleType,
      make: vehicle.make,
      model: vehicle.model,
      variant: vehicle.variant,
      year: vehicle.year,
      color: vehicle.color,
      // The VIN is here because a history nobody can tie to the car in front of them is not
      // a passport. The owner is told the link exposes it before they create one.
      identificationNumber: include.has('IDENTIFICATION_NUMBER')
        ? vehicle.identificationNumber
        : null,
      currentOdometer: vehicle.currentOdometer,
      odometerUnit: vehicle.odometerUnit,
      specs: vehicle.specs as Record<string, unknown>,
      // Deliberately null: a signed photo URL would outlive the link's revocation, since it
      // is minted by object storage and this application cannot recall it.
      primaryPhotoUrl: null,
    },

    ownership: {
      since: vehicle.purchaseDate,
      months: vehicle.purchaseDate
        ? monthsBetween(new Date(`${vehicle.purchaseDate}T00:00:00Z`), now)
        : null,
    },

    sections: [...include],

    /*
     * Omitted sections are null, never empty: "no services recorded" and "the owner chose not
     * to show services" are different statements, and a buyer should be able to tell which.
     */
    maintenance: include.has('MAINTENANCE')
      ? {
          recordCount: records.length,
          lastServicedAt: records.at(-1)?.performedAt.toISOString() ?? null,
          history: records.map((record) => ({
            title: record.title,
            performedAt: record.performedAt.toISOString(),
            odometer: record.odometer,
            // The shop that did the work is part of the service history a buyer is being shown;
            // the *person* who typed it in is not, and never appears.
            provider: record.provider,
            totalCost:
              include.has('MAINTENANCE_COSTS') &&
              record.totalCostAmountMinor !== null &&
              record.costCurrency
                ? { amountMinor: record.totalCostAmountMinor, currency: record.costCurrency }
                : null,
          })),
        }
      : null,

    condition: include.has('CONDITION')
      ? {
          overallScore: overallScore(standings),
          categories: standings.map((standing) => ({
            category: standing.category,
            score: standing.score,
            assessedAt: standing.assessedAt.toISOString(),
          })),
        }
      : null,

    documents: include.has('DOCUMENTS')
      ? documents.map((document) => ({
          documentType: document.documentType,
          title: document.title,
          issuedOn: document.issuedOn,
          expiresOn: document.expiresOn,
        }))
      : null,

    finances: include.has('FINANCES')
      ? {
          purchasePrice,
          totalInvested,
          currentValue: latestValuation
            ? { amountMinor: latestValuation.amountMinor, currency: latestValuation.currency }
            : null,
        }
      : null,

    health: { overall: health.overall, summary: health.summary },

    generatedAt: now.toISOString(),
  };
}

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { CostReportingMode, GarageRole } from '@vehicle-os/domain';

export interface GarageRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  defaultCurrency: string;
  costReporting: CostReportingMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface GarageWithMeta extends GarageRow {
  vehicleCount: number;
  role: GarageRole;
}

/**
 * Garages the actor belongs to, with the vehicle count and their own role.
 *
 * One query with a join and a grouped count rather than N+1: the garage list is the first
 * screen after sign-in, and a per-garage count query would put its latency on the critical
 * path of every session.
 */
export async function listForUser(db: Executor, userId: string): Promise<GarageWithMeta[]> {
  const rows = await db
    .select({
      id: schema.garages.id,
      name: schema.garages.name,
      description: schema.garages.description,
      ownerId: schema.garages.ownerId,
      defaultCurrency: schema.garages.defaultCurrency,
      costReporting: schema.garages.costReporting,
      createdAt: schema.garages.createdAt,
      updatedAt: schema.garages.updatedAt,
      role: schema.garageMembers.role,
      vehicleCount: count(schema.vehicles.id),
    })
    .from(schema.garages)
    .innerJoin(
      schema.garageMembers,
      and(
        eq(schema.garageMembers.garageId, schema.garages.id),
        eq(schema.garageMembers.userId, userId),
      ),
    )
    .leftJoin(
      schema.vehicles,
      and(
        eq(schema.vehicles.garageId, schema.garages.id),
        // Archived vehicles stay in the database but must not inflate the count shown on
        // the garage card.
        isNull(schema.vehicles.deletedAt),
      ),
    )
    .groupBy(schema.garages.id, schema.garageMembers.role)
    .orderBy(schema.garages.createdAt);

  return rows;
}

export async function findById(
  db: Executor,
  garageId: string,
  userId: string,
): Promise<GarageWithMeta | null> {
  const rows = await listForUser(db, userId);
  return rows.find((row) => row.id === garageId) ?? null;
}

export interface CreateGarageInput {
  name: string;
  description?: string | null;
  ownerId: string;
  defaultCurrency: string;
}

export async function insertGarage(db: Executor, input: CreateGarageInput): Promise<GarageRow> {
  const [row] = await db.insert(schema.garages).values(input).returning();
  if (!row) throw new Error('Garage insert returned no row');
  return row;
}

export async function updateGarage(
  db: Executor,
  garageId: string,
  changes: Partial<Pick<GarageRow, 'name' | 'description' | 'defaultCurrency'>>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.garages).set(changes).where(eq(schema.garages.id, garageId));
}

export async function deleteGarage(db: Executor, garageId: string): Promise<void> {
  await db.delete(schema.garages).where(eq(schema.garages.id, garageId));
}

// --- Members ----------------------------------------------------------------

export interface MemberRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  image: string | null;
  role: GarageRole;
  joinedAt: Date;
  /** The garage's own, live vehicles they are assigned to drive. */
  vehicleIds: string[];
}

export async function listMembers(db: Executor, garageId: string): Promise<MemberRow[]> {
  const [members, drives] = await Promise.all([
    db
      .select({
        id: schema.garageMembers.id,
        userId: schema.garageMembers.userId,
        email: schema.users.email,
        name: schema.users.name,
        image: schema.users.image,
        role: schema.garageMembers.role,
        joinedAt: schema.garageMembers.createdAt,
      })
      .from(schema.garageMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.garageMembers.userId))
      .where(eq(schema.garageMembers.garageId, garageId))
      // Owners first, then by join order, so the list reads as a hierarchy rather than an
      // arbitrary order that shifts as rows are updated.
      .orderBy(
        sql`case ${schema.garageMembers.role}
            when 'OWNER' then 0 when 'ADMIN' then 1 when 'MEMBER' then 2
            when 'DRIVER' then 3 else 4 end`,
        schema.garageMembers.createdAt,
      ),
    // Through the vehicle's garage, so an assignment left behind by a vehicle that moved, or
    // one that was archived, never shows.
    db
      .select({
        memberId: schema.vehicleDrivers.memberId,
        vehicleId: schema.vehicleDrivers.vehicleId,
      })
      .from(schema.vehicleDrivers)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.vehicleDrivers.vehicleId))
      .where(and(eq(schema.vehicles.garageId, garageId), isNull(schema.vehicles.deletedAt)))
      .orderBy(schema.vehicleDrivers.createdAt),
  ]);
  return members.map((member) => ({
    ...member,
    vehicleIds: drives.filter((row) => row.memberId === member.id).map((row) => row.vehicleId),
  }));
}

/** The garage's live vehicles among `vehicleIds`, for checking an assignment names only those. */
export async function liveVehicleIdsIn(
  db: Executor,
  garageId: string,
  vehicleIds: readonly string[],
): Promise<string[]> {
  if (vehicleIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.vehicles.id })
    .from(schema.vehicles)
    .where(
      and(
        eq(schema.vehicles.garageId, garageId),
        inArray(schema.vehicles.id, [...vehicleIds]),
        isNull(schema.vehicles.deletedAt),
      ),
    );
  return rows.map((row) => row.id);
}

/** Replaces everyone who drives a vehicle with `memberIds` — rows left by an old garage go too. */
export async function setVehicleDrivers(
  db: Executor,
  vehicleId: string,
  memberIds: readonly string[],
): Promise<void> {
  await db.delete(schema.vehicleDrivers).where(eq(schema.vehicleDrivers.vehicleId, vehicleId));
  if (memberIds.length === 0) return;
  await db
    .insert(schema.vehicleDrivers)
    .values(memberIds.map((memberId) => ({ vehicleId, memberId })));
}

/** Replaces everything a member drives with `vehicleIds`. */
export async function setMemberVehicles(
  db: Executor,
  memberId: string,
  vehicleIds: readonly string[],
): Promise<void> {
  await db.delete(schema.vehicleDrivers).where(eq(schema.vehicleDrivers.memberId, memberId));
  if (vehicleIds.length === 0) return;
  await db
    .insert(schema.vehicleDrivers)
    .values(vehicleIds.map((vehicleId) => ({ vehicleId, memberId })));
}

export async function findMember(
  db: Executor,
  garageId: string,
  memberId: string,
): Promise<MemberRow | null> {
  const members = await listMembers(db, garageId);
  return members.find((member) => member.id === memberId) ?? null;
}

export async function insertMember(
  db: Executor,
  input: { garageId: string; userId: string; role: GarageRole; invitedBy?: string | null },
): Promise<string> {
  const [row] = await db.insert(schema.garageMembers).values(input).returning({
    id: schema.garageMembers.id,
  });
  if (!row) throw new Error('Member insert returned no row');
  return row.id;
}

export async function updateMemberRole(
  db: Executor,
  memberId: string,
  role: GarageRole,
): Promise<void> {
  await db.update(schema.garageMembers).set({ role }).where(eq(schema.garageMembers.id, memberId));
}

export async function deleteMember(db: Executor, memberId: string): Promise<void> {
  await db.delete(schema.garageMembers).where(eq(schema.garageMembers.id, memberId));
}

export async function findUserByEmail(
  db: Executor,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const [row] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    // Addresses are compared case-insensitively; nobody thinks of Alice@ and alice@ as two
    // people, and treating them as two silently creates a duplicate membership attempt.
    .where(sql`lower(${schema.users.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

export async function countVehicles(db: Executor, garageIds: readonly string[]): Promise<number> {
  if (garageIds.length === 0) return 0;
  const [row] = await db
    .select({ total: count() })
    .from(schema.vehicles)
    .where(
      and(inArray(schema.vehicles.garageId, [...garageIds]), isNull(schema.vehicles.deletedAt)),
    );
  return row?.total ?? 0;
}

/**
 * How many garages this person owns, for the plan ceiling (GAPS §10).
 *
 * Owned, not joined: being a member of someone else's fleet costs the member nothing, and a
 * limit that counted memberships would mean an invitation could push a person over theirs.
 */
export async function countGaragesOwnedBy(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.garages)
    .where(eq(schema.garages.ownerId, userId));
  return row?.total ?? 0;
}

/**
 * How many vehicles sit in the garages this person owns.
 *
 * Archived ones are counted. A plan ceiling that ignored them would make "archive it" a free
 * way past the limit, and the row is still stored, served and backed up.
 */
export async function countVehiclesOwnedBy(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.vehicles)
    .innerJoin(schema.garages, eq(schema.vehicles.garageId, schema.garages.id))
    .where(and(eq(schema.garages.ownerId, userId), isNull(schema.vehicles.deletedAt)));
  return row?.total ?? 0;
}

/** People in one garage, the owner included — the `members` ceiling counts this. */
export async function countMembers(db: Executor, garageId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.garageMembers)
    .where(eq(schema.garageMembers.garageId, garageId));
  return row?.total ?? 0;
}

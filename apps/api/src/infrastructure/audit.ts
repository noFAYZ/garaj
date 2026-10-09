/**
 * Audit writer (Architecture.md §57).
 *
 * Written in the same transaction as the change it describes, so "the row changed but no
 * audit entry exists" is not a reachable state. There is deliberately no update or delete
 * helper here — the table is append-only, and the absence of a code path is a stronger
 * guarantee than a comment asking people not to.
 */

import { schema, type Executor } from '@vehicle-os/database';

export interface AuditEntry {
  readonly actorId: string | null;
  readonly actorEmail?: string | null;
  readonly garageId?: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
}

export async function recordAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    actorId: entry.actorId,
    actorEmail: entry.actorEmail ?? null,
    garageId: entry.garageId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata ?? {},
    requestId: entry.requestId ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}

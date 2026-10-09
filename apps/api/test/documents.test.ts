import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { and, eq } from 'drizzle-orm';
import { scanForExpiringDocuments } from '../src/modules/notifications/application/services/expiry-scan';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

interface Ticket {
  documentId: string;
  uploadUrl: string;
  storageKey: string;
}

/** `YYYY-MM-DD`, relative to today — expiry is a calendar date, not an instant. */
const inDays = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('documents', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Document Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const requestTicket = async (vehicle = vehicleId) => {
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicle}/documents/upload-url`,
      { filename: 'insurance.pdf', mimeType: 'application/pdf', sizeBytes: 180_000 },
    );
    return { status: response.status, ticket: response.body as Ticket };
  };

  /** Stands in for the client's direct PUT to object storage. */
  const completeUpload = (key: string, sizeBytes = 180_000) =>
    context.storage.put(key, { sizeBytes, mimeType: 'application/pdf', checksum: 'sha-1' });

  /** Ticket, upload, finalize — the whole three-step flow one call. */
  const upload = async (
    metadata: Record<string, unknown> = {},
    vehicle = vehicleId,
  ): Promise<{ id: string; status: number; body: unknown }> => {
    const { ticket } = await requestTicket(vehicle);
    await completeUpload(ticket.storageKey);
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicle}/documents/${ticket.documentId}/finalize`,
      { documentType: 'INSURANCE', title: 'Insurance certificate', ...metadata },
    );
    return { id: ticket.documentId, status: response.status, body: response.body };
  };

  describe('uploading', () => {
    it('issues a ticket whose key is scoped to the garage and vehicle', async () => {
      const { status, ticket } = await requestTicket();

      expect(status).toBe(201);
      // The tenant prefix (§30) — a key cannot be edited into another garage's namespace.
      expect(ticket.storageKey).toBe(
        `garages/${garageId}/vehicles/${vehicleId}/documents/${ticket.documentId}`,
      );
    });

    /*
     * A row offering a download of nothing is worse than no row: the insurance certificate
     * looks filed when it is not.
     */
    it('refuses to finalize when nothing was actually uploaded', async () => {
      const { ticket } = await requestTicket();

      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/documents/${ticket.documentId}/finalize`,
        { documentType: 'INSURANCE', title: 'Never uploaded' },
      );

      expect(response.status).toBe(409);
      expect((response.body as { error: { code: string } }).error.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('keeps a pending document out of the list until it is finalized', async () => {
      const { ticket } = await requestTicket();
      await completeUpload(ticket.storageKey);

      const before = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/documents`);
      const pendingListed = (before.body as { data: { id: string }[] }).data.some(
        (row) => row.id === ticket.documentId,
      );
      expect(pendingListed).toBe(false);

      await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/documents/${ticket.documentId}/finalize`,
        { documentType: 'REGISTRATION', title: 'Registration' },
      );

      const after = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/documents`);
      const listed = (after.body as { data: { id: string }[] }).data.some(
        (row) => row.id === ticket.documentId,
      );
      expect(listed).toBe(true);
    });

    /** The declared size was a request; what storage reports is what actually arrived. */
    it('records the size and type storage reports, not the ones the client declared', async () => {
      const { ticket } = await requestTicket();
      await completeUpload(ticket.storageKey, 220_500);

      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/documents/${ticket.documentId}/finalize`,
        { documentType: 'SERVICE_INVOICE', title: 'Invoice' },
      );

      expect(response.body).toMatchObject({ sizeBytes: 220_500, mimeType: 'application/pdf' });
    });

    it('rejects a file type that is not on the list', async () => {
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/documents/upload-url`,
        { filename: 'trap.html', mimeType: 'text/html', sizeBytes: 500 },
      );

      expect(response.status).toBe(400);
    });

    it('writes an audit entry when the upload is confirmed', async () => {
      const { id } = await upload({ title: 'Audited certificate' });

      const [entry] = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.resourceId, id),
            eq(schema.auditLogs.action, 'document.uploaded'),
          ),
        );

      expect(entry?.metadata).toMatchObject({ documentType: 'INSURANCE' });
    });
  });

  describe('reading', () => {
    it('never puts a URL in the metadata — the file is fetched through /download', async () => {
      const { body } = await upload();

      expect(body).not.toHaveProperty('url');
    });

    it('mints a short-lived signed URL on request', async () => {
      const { id } = await upload();

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/documents/${id}/download`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        filename: 'insurance.pdf',
        mimeType: 'application/pdf',
      });
      expect((response.body as { expiresInSeconds: number }).expiresInSeconds).toBeGreaterThan(0);
    });

    it('filters by document type', async () => {
      const filtered = await seedGarageWithVehicle(context, alice, 'Filter Garage');
      await upload({ documentType: 'INSURANCE', title: 'Cover' }, filtered.vehicleId);
      await upload({ documentType: 'MANUAL', title: 'Owner handbook' }, filtered.vehicleId);

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${filtered.vehicleId}/documents?documentType=MANUAL`,
      );
      const data = (response.body as { data: { title: string }[] }).data;

      expect(data).toHaveLength(1);
      expect(data[0]?.title).toBe('Owner handbook');
    });
  });

  describe('correcting and deleting', () => {
    it('updates the metadata without touching the file', async () => {
      const { id } = await upload();

      const response = await as(context, alice).patch(
        `/api/v1/vehicles/${vehicleId}/documents/${id}`,
        { title: 'Renewed certificate', expiresOn: inDays(200) },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        title: 'Renewed certificate',
        expiresOn: inDays(200),
        filename: 'insurance.pdf',
      });
    });

    /** Soft delete (§103): a certificate removed by mistake is worth being able to restore. */
    it('hides a deleted document but keeps the row', async () => {
      const { id } = await upload({ title: 'Deleted by mistake' });

      expect(
        (await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/documents/${id}`)).status,
      ).toBe(204);

      const listed = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/documents`);
      expect((listed.body as { data: { id: string }[] }).data.some((row) => row.id === id)).toBe(
        false,
      );

      const [row] = await context.database.db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      expect(row?.deletedAt).not.toBeNull();
    });

    it('is gone for reads and downloads once deleted', async () => {
      const { id } = await upload();
      await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/documents/${id}`);

      const download = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/documents/${id}/download`,
      );
      expect(download.status).toBe(404);
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for a vehicle in someone else s garage', async () => {
      const responses = await Promise.all([
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/documents`),
        as(context, bob).post(`/api/v1/vehicles/${vehicleId}/documents/upload-url`, {
          filename: 'x.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        }),
      ]);

      for (const response of responses) expect(response.status).toBe(404);
    });

    /** A signed URL is only ever minted after the authorization check. */
    it('will not mint a download URL for someone outside the garage', async () => {
      const { id } = await upload();

      const response = await as(context, bob).get(
        `/api/v1/vehicles/${vehicleId}/documents/${id}/download`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('expiry', () => {
    let expiryVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Expiry Garage');
      expiryVehicle = seeded.vehicleId;

      await upload(
        { documentType: 'INSURANCE', title: 'Cover', expiresOn: inDays(20) },
        expiryVehicle,
      );
      await upload(
        { documentType: 'REGISTRATION', title: 'Rego', expiresOn: inDays(-5) },
        expiryVehicle,
      );
      await upload({ documentType: 'MANUAL', title: 'Handbook' }, expiryVehicle);
      await upload(
        { documentType: 'WARRANTY', title: 'Long warranty', expiresOn: inDays(400) },
        expiryVehicle,
      );
    });

    it('lists what is expiring, most urgent first, with the vehicle named', async () => {
      const response = await as(context, alice).get('/api/v1/documents/expiring');
      const rows = response.body as { document: { title: string }; vehicleName: string }[];

      const titles = rows.map((row) => row.document.title);
      expect(titles).toContain('Rego');
      expect(titles).toContain('Cover');
      // Already expired is more urgent than expiring, so it comes first.
      expect(titles.indexOf('Rego')).toBeLessThan(titles.indexOf('Cover'));

      // Neither the undated handbook nor the one expiring in over a year is noise worth
      // putting in front of someone.
      expect(titles).not.toContain('Handbook');
      expect(titles).not.toContain('Long warranty');

      expect(rows[0]?.vehicleName).toBeTruthy();
    });

    it('counts the days, negative once it has passed', async () => {
      const response = await as(context, alice).get('/api/v1/documents/expiring');
      const rows = response.body as { document: { title: string }; daysRemaining: number }[];

      expect(rows.find((row) => row.document.title === 'Rego')?.daysRemaining).toBe(-5);
      expect(rows.find((row) => row.document.title === 'Cover')?.daysRemaining).toBe(20);
    });

    it('shows nothing of another garage to someone outside it', async () => {
      const response = await as(context, bob).get('/api/v1/documents/expiring');
      expect(response.body).toEqual([]);
    });

    it('narrows a vehicle list to what is expiring', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${expiryVehicle}/documents?expiringOnly=true`,
      );
      const titles = (response.body as { data: { title: string }[] }).data.map((row) => row.title);

      expect(titles.sort()).toEqual(['Cover', 'Rego']);
    });

    describe('the scheduled scan', () => {
      it('notifies each garage member once, with the specific type', async () => {
        const result = await scanForExpiringDocuments(context.database.db);
        expect(result.notified).toBeGreaterThan(0);

        const rows = await context.database.db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.userId, alice.userId));

        const types = rows.map((row) => row.notificationType);
        // "Your insurance expires" is actionable in a way "a document expires" is not.
        expect(types).toContain('INSURANCE_EXPIRING');
        expect(types).toContain('REGISTRATION_EXPIRING');
      });

      /*
       * A certificate left alone must be mentioned once, not every morning until it is
       * renewed — that is the noise §36 forbids.
       */
      it('says nothing the second time it runs over the same documents', async () => {
        const again = await scanForExpiringDocuments(context.database.db);
        expect(again.notified).toBe(0);
      });

      /** Renewing moves the date, which is in the key — so the next cycle notifies afresh. */
      it('notifies again once the expiry date has moved', async () => {
        const listed = await as(context, alice).get(
          `/api/v1/vehicles/${expiryVehicle}/documents?expiringOnly=true`,
        );
        const cover = (listed.body as { data: { id: string; title: string }[] }).data.find(
          (row) => row.title === 'Cover',
        )!;

        await as(context, alice).patch(`/api/v1/vehicles/${expiryVehicle}/documents/${cover.id}`, {
          expiresOn: inDays(30),
        });

        const result = await scanForExpiringDocuments(context.database.db);
        expect(result.notified).toBeGreaterThan(0);
      });
    });
  });
});

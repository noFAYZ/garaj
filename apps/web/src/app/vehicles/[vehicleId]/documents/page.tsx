'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import type { VehicleDocument, VehicleEvent } from '@vehicle-os/contracts';
import { DOCUMENT_TYPES, type DocumentType } from '@vehicle-os/domain';
import { ApiError, uploadDocument } from '@vehicle-os/api-client';
import { documentsQuery, eventsQuery, queryKeys } from '@vehicle-os/api-client/react';
import { daysUntil, spanOfDays } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import { Icon, type IconName } from '@/components/icons';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { SectionHeading } from '@/components/ui/overview';
import { ConfirmDelete, RowMenu } from '@/components/ui/row-actions';
import { ANY_VALUE, SelectField } from '@/components/ui/select-field';
import { Button, EmptyState, Field } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { formatDate, humanise } from '@/lib/format';
import { afterFade, clearRequest } from '@/lib/open-add';
import { cn } from '@/lib/utils';

const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((value) => ({ value, label: humanise(value) }));

/** Matches the server's list. A file outside it is refused before any upload starts. */
const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt';

const DOC_ICON: Partial<Record<DocumentType, IconName>> = {
  REGISTRATION: 'registration',
  INSURANCE: 'insurance',
  INSPECTION_REPORT: 'inspection',
  WARRANTY: 'warranty',
  MANUAL: 'manual',
  RECEIPT: 'receipt',
  SERVICE_INVOICE: 'maintenance',
  REPAIR_INVOICE: 'maintenance',
};
const iconFor = (type: DocumentType): IconName => DOC_ICON[type] ?? 'document';

/**
 * The papers a vehicle is expected to have — the ones asked for at a roadside stop, at a sale, at
 * renewal, and the ones that run out. All four are drawn whether or not they exist, because the
 * useful answer is as often "there is no insurance on file" as it is the policy itself, and a list
 * of whatever happened to be uploaded can never say that. (The phone app's documents, the same.)
 */
const KEY_DOCUMENTS: { type: DocumentType; label: string }[] = [
  { type: 'REGISTRATION', label: 'Registration' },
  { type: 'INSURANCE', label: 'Insurance' },
  { type: 'INSPECTION_REPORT', label: 'Inspection' },
  { type: 'WARRANTY', label: 'Warranty' },
];

/** Past this, an expiry is a date, not a warning — the server's "expiring soon" line. */
const SOON_DAYS = 60;

type Tone = 'late' | 'soon' | 'fine';

function expiry(document: VehicleDocument): { label: string; tone: Tone } | null {
  if (!document.expiresOn) return null;
  const days = daysUntil(document.expiresOn);
  if (days < 0) return { label: `Expired ${spanOfDays(-days)} ago`, tone: 'late' };
  if (days <= SOON_DAYS) return { label: `Expires in ${spanOfDays(days)}`, tone: 'soon' };
  return {
    label: `Until ${new Date(`${document.expiresOn}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })}`,
    tone: 'fine',
  };
}

/** On each status's solid tint — the pairs the contrast test checks — never coloured text. */
const TONE: Record<Tone, string> = {
  late: 'bg-destructive-soft text-destructive',
  soon: 'bg-warning-soft text-warning',
  fine: 'bg-success-soft text-success',
};

function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 truncate rounded-full px-2 text-[0.6875rem] font-semibold',
        TONE[tone],
      )}
    >
      {tone === 'fine' ? <Check className="size-3 shrink-0" strokeWidth={3} /> : null}
      {children}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A vehicle's paperwork: the four papers it is expected to have, then everything else — what runs
 * out first, then newest first. Adding is a dialog, from Add at the end of the section strip
 * (`?add=document`) or from a missing paper's tile, already set to that kind.
 */
export default function DocumentsPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // The kind the upload starts on; `null` is closed. Opened once any route cross-fade is over.
  const requested = searchParams.get('add');
  const [adding, setAdding] = useState<DocumentType | null>(null);
  useEffect(() => {
    if (requested === 'document') return afterFade(() => setAdding('REGISTRATION'));
  }, [requested]);

  // ponytail: the first page only (the API's default size); page through when a vehicle outgrows it.
  const documents = useQuery(documentsQuery(api, vehicleId));
  // ponytail: the first page of activity, newest first. A document attached to an older event
  // still carries its link; the row just cannot name it. Page through when that matters.
  const events = useQuery(eventsQuery(api, vehicleId));
  const eventList = events.data?.data ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['vehicles', vehicleId, 'documents'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.expiringDocuments() });
  }

  function close() {
    setAdding(null);
    if (requested) clearRequest();
  }

  if (documents.isError) {
    return (
      <EmptyState
        title="Could not load documents"
        description={documents.error.message}
        action={<Button onClick={() => void documents.refetch()}>Try again</Button>}
      />
    );
  }

  // A file whose upload never finished has nothing to open.
  const list = (documents.data?.data ?? []).filter((document) => document.uploadedAt !== null);

  /*
   * The newest of each key kind stands for it in the grid — a vehicle collects five years of
   * insurance certificates, and the current one is the one anybody wants. The older ones fall
   * through to the list with everything else.
   */
  const featured = new Map<DocumentType, VehicleDocument>();
  for (const document of list) {
    const isKey = KEY_DOCUMENTS.some((entry) => entry.type === document.documentType);
    if (isKey && !featured.has(document.documentType)) {
      featured.set(document.documentType, document);
    }
  }
  const remaining = list.filter((document) => featured.get(document.documentType) !== document);
  // What needs attention leads; the rest keep the server's order.
  const urgent = remaining.filter((document) => {
    const state = expiry(document);
    return state !== null && state.tone !== 'fine';
  });
  const others = [...urgent, ...remaining.filter((document) => !urgent.includes(document))];

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Key documents">
        {documents.isPending ? (
          <Loading label="Loading documents">
            <ul className={GRID}>
              {KEY_DOCUMENTS.map((key) => (
                <li key={key.type}>
                  <Skeleton className="h-32 w-full rounded-2xl" />
                </li>
              ))}
            </ul>
          </Loading>
        ) : (
          <ul className={GRID}>
            {KEY_DOCUMENTS.map((key, index) => (
              <KeyTile
                key={key.type}
                vehicleId={vehicleId}
                label={key.label}
                type={key.type}
                document={featured.get(key.type)}
                index={index}
                onAdd={setAdding}
                onDeleted={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 ? (
        <section aria-labelledby="documents-other" className="flex flex-col gap-4">
          <SectionHeading id="documents-other" title="Everything else" count={others.length} />
          {/* One panel of rows, hairlines between: a list to read down, not a wall of cards. */}
          <ul className="flex flex-col gap-px overflow-hidden rounded-2xl bg-border/60">
            {others.map((document, index) => (
              <DocumentRow
                key={document.id}
                vehicleId={vehicleId}
                document={document}
                eventTitle={eventList.find((event) => event.id === document.eventId)?.title ?? null}
                index={index}
                onDeleted={refresh}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {adding ? (
        <Modal
          title="Add a document"
          description="It goes straight to storage; only its details pass through Garaj."
          icon="upload"
          onClose={close}
        >
          <UploadForm
            vehicleId={vehicleId}
            initialType={adding}
            events={eventList}
            onDone={() => {
              close();
              refresh();
            }}
            onCancel={close}
          />
        </Modal>
      ) : null}
    </div>
  );
}

/** Two across on a phone, four on a wide screen: the four papers read as one set. */
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-4';

/**
 * Opens a document. The signed URL is fetched on the press, not with the list: it lives about five
 * minutes, so one minted when the page loaded would be dead by the time anyone pressed it.
 */
function useOpen(vehicleId: string, documentId: string | undefined) {
  return useMutation({
    mutationFn: () => api.documents.download(vehicleId, documentId!),
    onSuccess: (download) => window.open(download.url, '_blank', 'noopener,noreferrer'),
    // The new tab is the result.
    meta: { toast: false },
  });
}

/** Delete, behind ⋯ and a second press — a file gone is gone. */
function DocumentMenu({
  vehicleId,
  document,
  onDeleted,
}: {
  vehicleId: string;
  document: VehicleDocument;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.documents.remove(vehicleId, document.id),
    onSuccess: () => {
      setConfirming(false);
      onDeleted();
    },
    meta: { toast: 'Document deleted' },
  });
  return (
    <>
      <RowMenu
        label={`More for ${document.title}`}
        items={[
          {
            label: 'Delete document',
            icon: 'trash',
            destructive: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      {confirming ? (
        <ConfirmDelete
          title={`Delete “${document.title}”?`}
          description="The file goes from storage, and from any entry it was attached to."
          confirmLabel="Delete document"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/**
 * One of the four expected papers. On file, the tile is the document and opens it, with its
 * expiry doing the talking. Missing, it is an outline and a plus, and pressing it opens the upload
 * already set to that kind — so the gap the grid points out is one press from being filled.
 */
function KeyTile({
  vehicleId,
  label,
  type,
  document,
  index,
  onAdd,
  onDeleted,
}: {
  vehicleId: string;
  label: string;
  type: DocumentType;
  document: VehicleDocument | undefined;
  index: number;
  onAdd: (type: DocumentType) => void;
  onDeleted: () => void;
}) {
  const open = useOpen(vehicleId, document?.id);
  const state = document ? expiry(document) : null;

  return (
    <li className="stagger relative min-w-0 animate-rise" style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        onClick={() => (document ? open.mutate() : onAdd(type))}
        aria-busy={open.isPending || undefined}
        aria-label={
          document
            ? `${label}, on file${state ? `, ${state.label}` : ''}. Open ${document.title}`
            : `${label}, not added. Add one`
        }
        className={cn(
          'flex h-32 w-full flex-col justify-between rounded-2xl p-3.5 text-left transition-[background-color,border-color,scale] duration-200 active:scale-[0.98] aria-busy:animate-pulse',
          document
            ? 'bg-card/50 hover:bg-card'
            : // An outline, so a gap looks like a gap rather than a card that failed to load.
              'border border-dashed border-border-strong hover:border-muted-foreground hover:bg-card/30',
        )}
      >
        <span
          className={cn(
            'grid size-10 place-items-center rounded-xl',
            document ? 'bg-muted text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon name={iconFor(type)} size={20} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span
            className={cn(
              'truncate text-sm font-semibold',
              document ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          <span className="flex">
            {document ? (
              <StatusChip tone={state?.tone ?? 'fine'}>{state?.label ?? 'On file'}</StatusChip>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Plus className="size-3" strokeWidth={3} aria-hidden="true" />
                Not added
              </span>
            )}
          </span>
        </span>
      </button>
      {document ? (
        <span className="absolute right-2 top-2">
          <DocumentMenu vehicleId={vehicleId} document={document} onDeleted={onDeleted} />
        </span>
      ) : null}
    </li>
  );
}

function DocumentRow({
  vehicleId,
  document,
  eventTitle,
  index,
  onDeleted,
}: {
  vehicleId: string;
  document: VehicleDocument;
  eventTitle: string | null;
  index: number;
  onDeleted: () => void;
}) {
  const open = useOpen(vehicleId, document.id);
  const state = expiry(document);

  return (
    <li
      className="stagger flex animate-rise items-center bg-card pr-2 transition-colors hover:bg-popover"
      style={{ '--i': index } as CSSProperties}
    >
      <button
        type="button"
        onClick={() => open.mutate()}
        aria-busy={open.isPending || undefined}
        aria-label={`Open ${document.title}, ${humanise(document.documentType)}${state ? `, ${state.label}` : ''}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left aria-busy:animate-pulse"
      >
        <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-foreground">
          {document.thumbnailUrl ? (
            <img
              src={document.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <Icon name={iconFor(document.documentType)} size={20} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="w-full truncate text-sm font-semibold text-foreground">
            {document.title}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">
            {humanise(document.documentType)} ·{' '}
            <span className="font-mono tabular-nums">{formatBytes(document.sizeBytes)}</span>
            {eventTitle ? ` · ${eventTitle}` : ''}
          </span>
          {state ? <StatusChip tone={state.tone}>{state.label}</StatusChip> : null}
        </span>
      </button>
      <DocumentMenu vehicleId={vehicleId} document={document} onDeleted={onDeleted} />
    </li>
  );
}

/**
 * The upload, bare for its dialog. The file is a drop zone as well as a picker: a scan is usually
 * already sitting in a folder, a drag away.
 */
function UploadForm({
  vehicleId,
  initialType,
  events,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  initialType: DocumentType;
  events: readonly VehicleEvent[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType>(initialType);
  const [title, setTitle] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [eventId, setEventId] = useState(ANY_VALUE);

  const mutation = useMutation({
    mutationFn: () =>
      uploadDocument(api, vehicleId, file!, {
        documentType,
        // The filename is a reasonable title and a terrible one to have to retype.
        title: title.trim() || file!.name,
        ...(issuedOn ? { issuedOn } : {}),
        ...(expiresOn ? { expiresOn } : {}),
        ...(eventId !== ANY_VALUE ? { eventId } : {}),
      }),
    onSuccess: onDone,
    meta: { toast: 'Document added' },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (file) mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors',
          over ? 'border-foreground bg-muted' : 'border-border-strong bg-muted/40 hover:bg-muted',
        )}
      >
        <span className="grid size-11 place-items-center rounded-xl bg-card text-foreground">
          <Icon name={file ? iconFor(documentType) : 'upload'} size={22} />
        </span>
        <span className="max-w-full truncate text-sm font-semibold text-foreground">
          {file ? file.name : 'Drop a file here, or choose one'}
        </span>
        <span className="text-xs text-muted-foreground">
          {file ? formatBytes(file.size) : 'PDF, a photo, or an office file'}
        </span>
        <input
          type="file"
          accept={ACCEPTED}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="sr-only"
          required
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Type"
          value={documentType}
          onChange={(next) => setDocumentType(next as DocumentType)}
          options={DOCUMENT_TYPE_OPTIONS}
        />
        <Field
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={file?.name ?? 'Insurance certificate'}
          hint="Defaults to the filename."
          error={fieldErrors?.title}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField
          label="Issued on"
          value={issuedOn}
          onChange={setIssuedOn}
          max={expiresOn || undefined}
          error={fieldErrors?.issuedOn}
        />
        <DateField
          label="Expires on"
          value={expiresOn}
          onChange={setExpiresOn}
          min={issuedOn || undefined}
          hint="Without one, nothing can warn you before it runs out."
          error={fieldErrors?.expiresOn}
        />
      </div>

      {/* The invoice for the service, the MOT certificate for the inspection. */}
      {events.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="document-event" className="text-sm font-medium text-foreground">
            Belongs to
          </label>
          {/*
           * The label is built as text. It was children — a title, a dot and a date — and the old
           * select could only read a plain-string child, so the trigger showed the event's id once
           * one was chosen.
           */}
          <Select
            id="document-event"
            value={eventId}
            onValueChange={setEventId}
            ariaLabel="Belongs to"
            options={[
              { value: ANY_VALUE, label: 'Nothing in particular' },
              ...events.map((event) => ({
                value: event.id,
                label: `${event.title} · ${formatDate(event.occurredAt)}`,
              })),
            ]}
          />
          {fieldErrors?.eventId ? (
            <p className="text-xs text-destructive">{fieldErrors.eventId}</p>
          ) : null}
        </div>
      ) : null}

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!file} loading={mutation.isPending}>
          Upload
        </Button>
      </ModalActions>
    </form>
  );
}

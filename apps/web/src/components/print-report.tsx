'use client';

import { Printer } from 'lucide-react';
import { buttonClass } from '@/components/ui/primitives';

/**
 * Turning a page into a document (GAPS §16).
 *
 * The browser's own print-to-PDF, which `globals.css` already styles for ink — the same
 * mechanism the passport uses, and for the same reason: every phone and every browser already
 * knows how to render this page and save it as a file. A PDF renderer would mean a second
 * layout to maintain, a font pipeline and a headless browser held open on a server, to produce
 * the document the reader can already make.
 *
 * The print stylesheet hides every `button`, so this one takes itself out of the result.
 */
export function PrintButton({ label = 'Save as PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass('secondary', 'sm')}>
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * What the document is, shown only on paper.
 *
 * On screen the page is surrounded by navigation that says which vehicle this is. Printed, it
 * is a sheet in a folder with an insurer or a buyer, and a report that does not name its
 * subject, its period and the day it was produced is not a report — it is a screenshot.
 */
export function PrintHeading({
  title,
  subject,
  period,
}: {
  title: string;
  subject: string | undefined;
  period?: string;
}) {
  return (
    <header className="hidden print:mb-6 print:block print:border-b print:pb-4">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{subject ?? 'Vehicle'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {period ? `${period} · ` : ''}
        {/*
         * The date the sheet was produced, not the date it is read. A figure in a folder is
         * only as good as knowing when it was true.
         */}
        Produced {new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}
      </p>
    </header>
  );
}

/**
 * Safety recalls, from NHTSA.
 *
 * Same shape as `vin.ts` and `fx.ts`: `fetch` with a deadline, and null rather than an error.
 * A recall check that cannot run this week runs next week; failing the scan over one model
 * would stop every other vehicle's check with it.
 *
 * The public API answers by make, model and model year — not by VIN. So every result here is
 * "vehicles like yours were recalled", never "yours is": trims, build dates and plants narrow a
 * campaign in ways this lookup cannot see, and a remedy may already have been done.
 */

export interface Recall {
  /** NHTSA's campaign number, e.g. `23V123000`. Stable, so it is the dedupe key. */
  readonly campaign: string;
  readonly component: string;
  readonly summary: string;
  readonly remedy: string | null;
  readonly reportedOn: string | null;
}

interface RecallResponse {
  results?: {
    NHTSACampaignNumber?: string;
    Component?: string;
    Summary?: string;
    Remedy?: string;
    ReportReceivedDate?: string;
  }[];
}

export function mapRecalls(body: RecallResponse): Recall[] {
  return (body.results ?? [])
    .filter((row) => row.NHTSACampaignNumber)
    .map((row) => ({
      campaign: row.NHTSACampaignNumber!.trim(),
      component: row.Component?.trim() || 'Unspecified component',
      summary: row.Summary?.trim() || '',
      remedy: row.Remedy?.trim() || null,
      reportedOn: row.ReportReceivedDate?.trim() || null,
    }));
}

export async function recallsFor(
  baseUrl: string,
  vehicle: { make: string; model: string; year: number },
  log?: { warn: (o: object, m: string) => void },
): Promise<Recall[] | null> {
  const url = new URL(baseUrl);
  url.searchParams.set('make', vehicle.make);
  url.searchParams.set('model', vehicle.model);
  url.searchParams.set('modelYear', String(vehicle.year));

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    // NHTSA answers 400 for a make/model it has never heard of — the common case outside the
    // US market, and not an error worth logging per vehicle.
    if (response.status === 400 || response.status === 404) return [];
    if (!response.ok) throw new Error(`Recalls API returned ${response.status}`);
    return mapRecalls((await response.json()) as RecallResponse);
  } catch (error) {
    log?.warn({ err: error, ...vehicle }, 'Recall lookup failed; will retry on the next scan');
    return null;
  }
}

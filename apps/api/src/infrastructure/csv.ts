/**
 * CSV, both directions.
 *
 * RFC 4180 by hand rather than a library: the job is a quoting rule and a small state
 * machine, and the two `csv-*` packages that would do it bring a stream abstraction this
 * codebase has no use for — exports are assembled in memory and imports are bounded by the
 * route's body limit.
 *
 * The parser is a character loop, not a `split(',')`: a vendor description reading
 * `Brakes, front` and an address with a newline in it are both ordinary in a fuel log, and
 * splitting on the separator shifts every column after them by one without erroring.
 */

/** Wrapped only when it must be — an unquoted file is the one a spreadsheet opens cleanly. */
function escapeField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * `null` and `undefined` become an empty field, never the strings "null" or "undefined".
 *
 * A literal `null` in a spreadsheet cell is the kind of thing that survives a round trip
 * and reappears as a vendor name.
 */
function toField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return escapeField(String(value));
}

/**
 * Rows out, in the order `columns` names them.
 *
 * CRLF line endings, which is what RFC 4180 specifies and what Excel needs to not treat the
 * whole file as one line on Windows.
 */
export function toCsv<T extends Record<string, unknown>>(
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const lines = [columns.map(escapeField).join(',')];
  for (const row of rows) lines.push(columns.map((column) => toField(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Drops a leading byte-order mark, which Excel writes and nobody means. */
function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/**
 * Every field of every record, quotes resolved.
 *
 * Returns rows of raw strings — no header handling and no type guessing, because what a
 * column *means* differs per vendor and belongs in the mapping, not here.
 */
export function parseCsv(input: string, delimiter = ','): string[][] {
  // A BOM from Excel would otherwise become part of the first header name, so the column
  // lookup misses it and the whole file imports as blank.
  const text = stripBom(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline would otherwise append a row of one empty field to every file.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote, not the end of it.
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      // CRLF is one row break, not two.
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * A parsed file as records keyed by header name.
 *
 * Header names are lowercased and stripped of everything but letters and digits before
 * being used as keys: the same export from two versions of the same app writes "Odometer
 * (km)" and "odometer_km", and a mapping that has to list both spellings is a mapping that
 * silently drops a column on the third.
 */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Comma or semicolon, decided by the header line.
 *
 * Several European exports — Drivvo's among them — write semicolons, because a comma is the
 * decimal point there. Getting this wrong does not error: the whole file parses as one
 * column per row and imports as nothing, which looks like an empty file rather than a
 * delimiter problem. Counted on the first line only, where quoting has not started yet.
 */
export function detectDelimiter(input: string): string {
  const header = stripBom(input).split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

export interface CsvRecords {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

export function parseCsvRecords(input: string, delimiter = detectDelimiter(input)): CsvRecords {
  const rows = parseCsv(input, delimiter);
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0]!.map(normaliseHeader);
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, position) => {
      if (header) record[header] = (cells[position] ?? '').trim();
    });
    return record;
  });

  return { headers, rows: records };
}

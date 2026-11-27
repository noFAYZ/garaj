/**
 * Every email the product sends: the account's own mail (a reset link, an address to confirm)
 * and the reminders. One layout renders both an HTML and a plain-text part from the same parts,
 * so the two can never say different things.
 *
 * Email clients are not browsers: no oklch, no flexbox, styles inline, tables for layout. The
 * colours are the light theme's tokens (`packages/ui/src/tokens.ts`) converted to hex, with the
 * `*Soft` washes flattened onto the card; the dark block repeats the dark theme for the clients
 * that honour `prefers-color-scheme` (Apple Mail, iOS, Outlook.com). Copper is identity only —
 * the key and the wordmark — and statuses keep red, amber and blue, as in the app.
 *
 * Everything a user typed (a vehicle's nickname, a plan's title) is escaped: it lands in HTML.
 */

import type { NotificationType } from '@vehicle-os/domain';

export const BRAND = 'Garajj';
export const SITE = 'https://garajj.fayzan.xyz';
export const SUPPORT = 'support@fayzan.xyz';

export const C = {
  page: '#f3f0ea',
  card: '#fefdfb',
  ink: '#18130f',
  muted: '#615952',
  border: '#d9d3cc',
  copper: '#ba571a',
  copperEdge: '#893a10',
  onCopper: '#fdfcfa',
};

type Tone = 'danger' | 'warning' | 'info';

/** [text, wash] per tone, light then dark. */
const TONES: Record<Tone, { light: [string, string]; dark: [string, string] }> = {
  danger: { light: ['#be222a', '#f8e7e6'], dark: ['#fb605c', '#3b2522'] },
  warning: { light: ['#845b00', '#f1ebdf'], dark: ['#eabe4a', '#3b3220'] },
  info: { light: ['#09659f', '#e6eef2'], dark: ['#6bb9f8', '#2a3035'] },
};

export const SANS =
  "'Albert Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

interface Layout {
  /** The grey line inbox lists show after the subject. */
  readonly preheader: string;
  readonly chip?: { readonly label: string; readonly tone: Tone };
  readonly heading: string;
  readonly lines: readonly string[];
  readonly facts?: readonly (readonly [label: string, value: string])[];
  readonly action?: { readonly label: string; readonly url: string };
  /** Small print under a rule: how long a link lasts, what to do if it wasn't you. */
  readonly note?: string;
  /** Why this address got this email, in the footer. */
  readonly why: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

function html(subject: string, l: Layout): string {
  const e = escapeHtml;
  const tone = l.chip ? TONES[l.chip.tone] : null;

  const chip =
    l.chip && tone
      ? `<tr><td style="padding:0 0 14px"><span class="chip" style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone.light[1]};color:${tone.light[0]};font:700 11px/14px ${SANS};letter-spacing:.08em;text-transform:uppercase">${e(l.chip.label)}</span></td></tr>`
      : '';

  const lines = l.lines
    .map(
      (line, i) =>
        `<tr><td class="${i === 0 ? 'ink' : 'muted'}" style="padding:0 0 14px;font:400 16px/25px ${SANS};color:${i === 0 ? C.ink : C.muted}">${e(line)}</td></tr>`,
    )
    .join('');

  const facts = l.facts?.length
    ? `<tr><td style="padding:6px 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${l.facts
        .map(
          ([label, value]) =>
            `<tr><td class="muted rule" style="padding:11px 12px 11px 0;border-top:1px solid ${C.border};font:600 11px/16px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};white-space:nowrap;vertical-align:middle">${e(label)}</td><td class="ink rule" align="right" style="padding:11px 0;border-top:1px solid ${C.border};font:500 14px/20px ${MONO};color:${C.ink}">${e(value)}</td></tr>`,
        )
        .join('')}</table></td></tr>`
    : '';

  const action = l.action
    ? `<tr><td style="padding:12px 0 22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="key" bgcolor="${C.copper}" style="border-radius:12px;background:${C.copper};border-bottom:2px solid ${C.copperEdge}"><a class="key-a" href="${e(l.action.url)}" target="_blank" style="display:inline-block;padding:14px 24px;font:600 15px/20px ${SANS};color:${C.onCopper};text-decoration:none;border-radius:12px">${e(l.action.label)}</a></td></tr></table></td></tr>
<tr><td class="muted" style="padding:0 0 18px;font:400 13px/20px ${SANS};color:${C.muted}">Button not working? Paste this into your browser:<br><a href="${e(l.action.url)}" target="_blank" class="link" style="color:${C.copper};word-break:break-all;text-decoration:underline">${e(l.action.url)}</a></td></tr>`
    : '';

  const note = l.note
    ? `<tr><td class="muted rule" style="padding:18px 0 0;border-top:1px solid ${C.border};font:400 13px/20px ${SANS};color:${C.muted}">${e(l.note)}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{color:${C.copper}}
@media (max-width:600px){.pad{padding:28px 22px!important}.h1{font-size:24px!important;line-height:30px!important}}
@media (prefers-color-scheme:dark){
.page{background:#090705!important}
.card{background:#211d1a!important;border-color:#393430!important}
.ink{color:#f5efe7!important}
.muted{color:#b1a9a2!important}
.rule{border-color:#393430!important}
.key{background:#e27c43!important;border-color:#9c5131!important}
.key-a{color:#18130f!important}
.muted a{color:#b1a9a2!important}
.muted a.link{color:#e27c43!important}
.chip{background:${tone ? tone.dark[1] : 'transparent'}!important;color:${tone ? tone.dark[0] : 'inherit'}!important}
}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(l.preheader)}${'&#8199;&#65279;&#847; '.repeat(40)}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}">
<tr><td align="center" style="padding:32px 12px 40px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px">
<a href="${SITE}" target="_blank" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;vertical-align:middle"><img src="${SITE}/apple-icon.png" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:9px;border:1px solid ${C.border}"></td>
<td class="ink" style="vertical-align:middle;font:700 19px/24px ${SANS};letter-spacing:-.01em;color:${C.ink}">${BRAND}</td>
</tr></table></a>
</td></tr>
<tr><td class="card pad" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:20px;padding:36px 36px 30px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${chip}
<tr><td class="ink h1" style="padding:0 0 14px;font:700 26px/32px ${SANS};letter-spacing:-.02em;color:${C.ink}">${e(l.heading)}</td></tr>
${lines}${facts}${action}${note}
</table>
</td></tr>
<tr><td class="muted" style="padding:22px 8px 0;font:400 12px/19px ${SANS};color:${C.muted}">
${e(l.why)}<br>
<a href="${SITE}" target="_blank" style="color:${C.muted};text-decoration:underline">${BRAND}</a> &nbsp;·&nbsp; <a href="mailto:${SUPPORT}" style="color:${C.muted};text-decoration:underline">${SUPPORT}</a>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

function text(l: Layout): string {
  return [
    BRAND.toUpperCase(),
    '',
    ...(l.chip ? [l.chip.label.toUpperCase()] : []),
    l.heading,
    '',
    ...l.lines.flatMap((line) => [line, '']),
    ...(l.facts?.length ? [...l.facts.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(l.action ? [`${l.action.label}:`, l.action.url, ''] : []),
    ...(l.note ? [l.note, ''] : []),
    '—',
    l.why,
    `${BRAND} · ${SITE} · ${SUPPORT}`,
  ].join('\n');
}

function render(subject: string, layout: Layout): RenderedEmail {
  return { subject, html: html(subject, layout), text: text(layout) };
}

// ── Account ─────────────────────────────────────────────────────────────────────────────────────

export function passwordResetEmail(link: string): RenderedEmail {
  return render(`Reset your ${BRAND} password`, {
    preheader: 'Choose a new password. The link works for one hour.',
    heading: 'Reset your password',
    lines: [
      `Someone asked to reset the password for the ${BRAND} account on this address. If it was you, choose a new one below.`,
      'Saving a new password signs you out on every other device.',
    ],
    action: { label: 'Choose a new password', url: link },
    note: "The link works for one hour. If you didn't ask for this, ignore this email: your password stays as it is.",
    why: 'You got this because a password reset was requested for this address.',
  });
}

export function confirmEmailEmail(link: string): RenderedEmail {
  return render(`Confirm your email for ${BRAND}`, {
    preheader: 'One tap, so people can share their garage with you.',
    heading: 'Confirm your email',
    lines: [
      `Welcome to ${BRAND}. Confirm this is your address, and you're set.`,
      "Until it's confirmed, nobody can add you to their garage.",
    ],
    action: { label: 'Confirm email', url: link },
    note: "The link works for 24 hours. If you didn't sign up, ignore this email and nothing happens.",
    why: `You got this because this address was used to sign up for ${BRAND}.`,
  });
}

// ── Reminders ───────────────────────────────────────────────────────────────────────────────────

export interface NotificationEmailInput {
  readonly notificationType: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly payload: Record<string, unknown>;
  readonly vehicleId: string | null;
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function longDate(value: unknown): string | null {
  const iso = str(value);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function status(type: NotificationType, days: number | null): { label: string; tone: Tone } {
  switch (type) {
    case 'MAINTENANCE_OVERDUE':
      return { label: 'Overdue', tone: 'danger' };
    case 'MAINTENANCE_DUE':
      return { label: 'Due soon', tone: 'warning' };
    case 'TASK_OVERDUE':
      return { label: 'Task overdue', tone: 'danger' };
    case 'TASK_DUE':
      return { label: 'Task due', tone: 'warning' };
    case 'DOCUMENT_EXPIRING':
    case 'REGISTRATION_EXPIRING':
    case 'INSURANCE_EXPIRING':
    case 'WARRANTY_EXPIRING':
      if (days !== null && days < 0) return { label: 'Expired', tone: 'danger' };
      if (days === 0) return { label: 'Expires today', tone: 'danger' };
      return { label: 'Expiring soon', tone: 'warning' };
    case 'RECALL':
      // A likelihood, not a finding: amber, never red.
      return { label: 'Possible recall', tone: 'warning' };
    default:
      return { label: 'Reminder', tone: 'info' };
  }
}

/**
 * A reminder, from the same row the bell shows. `webUrl` only becomes a button when it is a real
 * https address — a development or misconfigured `WEB_URL` would otherwise put a dead
 * `localhost` link in someone's inbox.
 */
export function notificationEmail(n: NotificationEmailInput, webUrl?: string): RenderedEmail {
  const days = typeof n.payload.daysRemaining === 'number' ? n.payload.daysRemaining : null;
  const chip = status(n.notificationType, days);
  const web = webUrl?.startsWith('https://') ? webUrl.replace(/\/$/, '') : null;
  const open =
    web && n.vehicleId
      ? { label: `Open in ${BRAND}`, url: `${web}/vehicles/${n.vehicleId}` }
      : undefined;
  const why = `You got this because email reminders are on for your garage. To stop them, write to ${SUPPORT}.`;

  if (n.notificationType === 'RECALL') {
    const summary = str(n.payload.summary);
    const campaign = str(n.payload.campaign);
    const remedy = str(n.payload.remedy);
    const reported = longDate(n.payload.reportedOn);
    return render(n.title, {
      preheader: n.body,
      chip,
      heading: str(n.payload.component) ?? n.title,
      lines: summary ? [n.body, summary] : [n.body],
      facts: [
        ...(campaign ? [['Campaign', campaign] as const] : []),
        ...(reported ? [['Reported', reported] as const] : []),
      ],
      action: { label: 'Check your VIN on NHTSA', url: 'https://www.nhtsa.gov/recalls' },
      note: remedy ? `Remedy: ${remedy}` : undefined,
      why,
    });
  }

  const until = longDate(n.payload.expiresOn ?? n.payload.warrantyUntil);
  return render(`${chip.label}: ${n.title}`, {
    preheader: n.body,
    chip,
    heading: n.title,
    lines: [n.body],
    facts: until ? [[days !== null && days < 0 ? 'Expired' : 'Expires', until]] : undefined,
    action: open,
    why,
  });
}

// ── Previews ────────────────────────────────────────────────────────────────────────────────────

export interface EmailPreview extends RenderedEmail {
  readonly id: string;
  readonly name: string;
  readonly kind: 'Account' | 'Reminder';
  /** When it goes out. */
  readonly when: string;
}

/**
 * Every email the product sends, rendered with made-up content for the admin console. The links
 * are real pages on `apiUrl` with dummy tokens, so a click shows the "expired" page.
 */
export function emailPreviews(apiUrl: string, webUrl?: string): EmailPreview[] {
  const api = apiUrl.replace(/\/$/, '');
  const car = { payload: {}, vehicleId: '00000000-0000-0000-0000-000000000000' };
  const reminder = (
    n: Omit<NotificationEmailInput, 'vehicleId' | 'payload'> & {
      payload?: Record<string, unknown>;
    },
  ) => notificationEmail({ ...car, ...n }, webUrl);
  return [
    {
      id: 'reset-password',
      name: 'Password reset',
      kind: 'Account',
      when: 'Someone taps "Forgot password" on sign-in.',
      ...passwordResetEmail(`${api}/account/reset-password?token=preview`),
    },
    {
      id: 'confirm-email',
      name: 'Confirm email',
      kind: 'Account',
      when: 'Right after sign-up, and again from Settings → Account.',
      ...confirmEmailEmail(
        `${api}/api/auth/verify-email?token=preview&callbackURL=${encodeURIComponent(`${api}/account/email-confirmed`)}`,
      ),
    },
    {
      id: 'service-due',
      name: 'Service due soon',
      kind: 'Reminder',
      when: 'A maintenance plan comes within its reminder window.',
      ...reminder({
        notificationType: 'MAINTENANCE_DUE',
        title: 'Oil change',
        body: '2019 Honda Civic is 800 km from its Oil change.',
      }),
    },
    {
      id: 'service-overdue',
      name: 'Service overdue',
      kind: 'Reminder',
      when: 'A maintenance plan passes its due date or distance.',
      ...reminder({
        notificationType: 'MAINTENANCE_OVERDUE',
        title: 'Brake fluid',
        body: '2019 Honda Civic: Brake fluid was due 9 days ago.',
      }),
    },
    {
      id: 'document-expiring',
      name: 'Document expiring',
      kind: 'Reminder',
      when: 'Insurance, registration or another document is within 30 days of expiring.',
      ...reminder({
        notificationType: 'INSURANCE_EXPIRING',
        title: 'Insurance certificate',
        body: '2019 Honda Civic: Insurance certificate expires in 12 days.',
        payload: { daysRemaining: 12, expiresOn: '2026-12-10' },
      }),
    },
    {
      id: 'document-expired',
      name: 'Document expired',
      kind: 'Reminder',
      when: 'A document passed its expiry date.',
      ...reminder({
        notificationType: 'REGISTRATION_EXPIRING',
        title: 'Registration',
        body: '2019 Honda Civic: Registration expired 3 days ago.',
        payload: { daysRemaining: -3, expiresOn: '2026-11-25' },
      }),
    },
    {
      id: 'warranty-ending',
      name: 'Part warranty ending',
      kind: 'Reminder',
      when: "A fitted part's warranty is ending, or just ended.",
      ...reminder({
        notificationType: 'WARRANTY_EXPIRING',
        title: 'Battery warranty',
        body: '2019 Honda Civic: the warranty on the battery ends in 20 days.',
        payload: { daysRemaining: 20, warrantyUntil: '2026-12-18' },
      }),
    },
    {
      id: 'recall',
      name: 'Possible recall',
      kind: 'Reminder',
      when: 'A new NHTSA recall matches a vehicle by make, model and year.',
      ...reminder({
        notificationType: 'RECALL',
        title: 'Possible recall: Air bags',
        body: '2019 Honda Civic may be affected by NHTSA recall 23V-017 (Air bags). This matches the make, model and year — check your VIN at nhtsa.gov/recalls to confirm, and whether the remedy has already been done.',
        payload: {
          component: 'Air bags',
          campaign: '23V-017',
          summary: 'The driver frontal air bag inflator may rupture during deployment.',
          remedy: 'Dealers will replace the inflator, free of charge.',
          reportedOn: '2023-01-12',
        },
      }),
    },
  ];
}

/**
 * The two pages an account email links to: choose a new password, and "email confirmed".
 *
 * Served by the API itself, on its own origin: the form posts back here and Better Auth is called
 * server-side, so there is no CORS, no trusted origin to add and no JavaScript — and the links work
 * wherever the person reads their mail, whether or not the web app is deployed. The look is the
 * emails' (`email-templates.ts`): same card, same tokens, light and dark.
 *
 * Registered without `fastify-plugin`, so the form-body parser below stays inside these routes.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  BRAND,
  C,
  SANS,
  SITE,
  SUPPORT,
  escapeHtml as e,
} from '../modules/notifications/application/services/email-templates';

const MIN_PASSWORD = 12; // `minPasswordLength` in auth.ts

const ICON = {
  ok: '<path d="M5.5 12.5l4.2 4.2L18.5 7.5" />',
  error: '<path d="M12 6v8" /><path d="M12 18.5h.01" />',
};

interface Page {
  readonly title: string;
  readonly mark?: 'ok' | 'error';
  readonly lines: readonly string[];
  /** Raw HTML, already escaped by the caller. */
  readonly form?: string;
}

function page({ title, mark, lines, form }: Page): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${e(title)} · ${BRAND}</title>
<link rel="icon" href="${SITE}/icon.png">
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--page:${C.page};--card:${C.card};--ink:${C.ink};--muted:${C.muted};--border:${C.border};--field:#f7f5f1;--copper:${C.copper};--edge:${C.copperEdge};--on:${C.onCopper};--halo:#ba571a26;--ok:#00713e;--ok-soft:#e5f0ea;--bad:#be222a;--bad-soft:#f8e7e6}
@media (prefers-color-scheme:dark){:root{--page:#090705;--card:#211d1a;--ink:#f5efe7;--muted:#b1a9a2;--border:#393430;--field:#2e2925;--copper:#e27c43;--edge:#9c5131;--on:#18130f;--halo:#e27c4333;--ok:#5ec386;--ok-soft:#24302a;--bad:#fb605c;--bad-soft:#3b2522}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:32px 16px;background:var(--page);color:var(--ink);font:16px/1.55 ${SANS};-webkit-font-smoothing:antialiased}
main{width:100%;max-width:420px}
.brand{display:inline-flex;align-items:center;gap:10px;margin:0 0 18px 4px;color:var(--ink);font-weight:700;font-size:19px;letter-spacing:-.01em;text-decoration:none}
.brand img{width:32px;height:32px;border-radius:9px;border:1px solid var(--border)}
.card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:32px 28px 28px}
.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;margin:0 0 18px}
.mark svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.ok{background:var(--ok-soft);color:var(--ok)}.error{background:var(--bad-soft);color:var(--bad)}
h1{margin:0 0 10px;font-size:26px;line-height:32px;letter-spacing:-.02em}
p{margin:0 0 12px;color:var(--muted)}p:first-of-type{color:var(--ink)}
.alert{margin:18px 0 0;padding:11px 14px;border-radius:12px;background:var(--bad-soft);color:var(--bad);font-size:14px;font-weight:500}
label{display:block;margin:18px 0 6px;font-size:13px;font-weight:600}
input{width:100%;height:48px;padding:0 14px;border:1px solid var(--border);border-radius:12px;background:var(--field);color:var(--ink);font:inherit}
input:focus{outline:none;border-color:var(--copper);box-shadow:0 0 0 4px var(--halo)}
button{width:100%;height:50px;margin:24px 0 0;border:0;border-bottom:2px solid var(--edge);border-radius:12px;background:var(--copper);color:var(--on);font:600 16px/1 ${SANS};cursor:pointer}
button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 4px var(--halo)}
footer{margin:18px 8px 0;font-size:12px;line-height:19px;color:var(--muted)}footer a{color:inherit}
</style>
</head>
<body>
<main>
<a class="brand" href="${SITE}"><img src="${SITE}/apple-icon.png" alt="">${BRAND}</a>
<div class="card">
${mark ? `<div class="mark ${mark}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[mark]}</svg></div>` : ''}
<h1>${e(title)}</h1>
${lines.map((line) => `<p>${e(line)}</p>`).join('\n')}
${form ?? ''}
</div>
<footer>Need a hand? <a href="mailto:${SUPPORT}">${SUPPORT}</a></footer>
</main>
</body>
</html>`;
}

function resetForm(token: string, error?: string): string {
  return page({
    title: 'Choose a new password',
    lines: [
      `At least ${MIN_PASSWORD} characters.`,
      'Saving it signs you out on every other device.',
    ],
    form: `${error ? `<p class="alert" role="alert">${e(error)}</p>` : ''}
<form method="post" action="/account/reset-password">
<input type="hidden" name="token" value="${e(token)}">
<label for="password">New password</label>
<input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="128" required autofocus>
<label for="confirm">Type it again</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="128" required>
<button type="submit">Save password</button>
</form>`,
  });
}

const EXPIRED = page({
  title: 'This link has expired',
  mark: 'error',
  lines: [
    'Reset links work for one hour, and only once.',
    `Ask for a new one from "Forgot password" on the ${BRAND} sign-in screen.`,
  ],
});

const send = (reply: FastifyReply, html: string, status = 200) =>
  reply
    .status(status)
    .type('text/html; charset=utf-8')
    // A reset token sits in this page; no cache keeps a copy of it.
    .header('cache-control', 'no-store')
    .send(html);

const accountPages: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 4096 },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  fastify.get<{ Querystring: { token?: string } }>(
    '/reset-password',
    { schema: { hide: true } },
    async (request, reply) => {
      const token = request.query.token;
      return token ? send(reply, resetForm(token)) : send(reply, EXPIRED, 400);
    },
  );

  fastify.post<{ Body: { token?: string; password?: string; confirm?: string } }>(
    '/reset-password',
    { schema: { hide: true } },
    async (request, reply) => {
      const { token = '', password = '', confirm = '' } = request.body ?? {};
      if (!token) return send(reply, EXPIRED, 400);
      if (password.length < MIN_PASSWORD)
        return send(reply, resetForm(token, `Use at least ${MIN_PASSWORD} characters.`), 400);
      if (password !== confirm)
        return send(reply, resetForm(token, "The two passwords don't match."), 400);

      try {
        await fastify.auth.api.resetPassword({ body: { newPassword: password, token } });
      } catch (error) {
        const code = (error as { body?: { code?: string } }).body?.code;
        if (code === 'INVALID_TOKEN') return send(reply, EXPIRED, 400);
        if (code === 'PASSWORD_TOO_LONG')
          return send(reply, resetForm(token, 'Use 128 characters or fewer.'), 400);
        request.log.error({ err: error }, 'Password reset failed');
        return send(reply, resetForm(token, "That didn't work. Try again in a moment."), 500);
      }

      return send(
        reply,
        page({
          title: 'Password changed',
          mark: 'ok',
          lines: [`Go back to ${BRAND} and sign in with your new password.`],
        }),
      );
    },
  );

  // Better Auth redirects here after checking a confirmation link, with `?error=` if it failed.
  fastify.get<{ Querystring: { error?: string } }>(
    '/email-confirmed',
    { schema: { hide: true } },
    async (request, reply) =>
      request.query.error
        ? send(
            reply,
            page({
              title: "This link didn't work",
              mark: 'error',
              lines: [
                'Confirmation links work for 24 hours, and only once.',
                `For a new one, open ${BRAND} and go to Settings → Account → Confirm your email.`,
              ],
            }),
            400,
          )
        : send(
            reply,
            page({
              title: 'Email confirmed',
              mark: 'ok',
              lines: [`You're all set. You can close this tab and go back to ${BRAND}.`],
            }),
          ),
  );
};

export default accountPages;

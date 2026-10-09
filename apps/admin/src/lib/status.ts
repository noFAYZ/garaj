import {
  Activity as Pulse,
  Bot,
  CreditCard,
  Database,
  HardDrive,
  Layers,
  Mail,
  Radar,
  Smartphone,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Overview, SystemState, Usage } from './api';
import { formatCount, percent, span } from './format';
import type { Health } from './queries';

export type Tone = 'success' | 'warning' | 'destructive' | 'muted';

/** One part of the system: lit green when well, amber when it wants a look, red when broken. */
export interface Part {
  key: string;
  name: string;
  icon: LucideIcon;
  tone: Tone;
  /** One word or figure: "Up 3h", "280 ms", "2 dead". */
  state: string;
  /** What it is for, or what is wrong with it. */
  detail: string;
}

/** A backlog this long means the worker is not keeping up, or not running. */
export const BACKLOG = 50;

const RANK: Record<Tone, number> = { destructive: 3, warning: 2, success: 1, muted: 0 };
export const worst = (parts: Part[]): Tone =>
  parts.reduce<Tone>((tone, part) => (RANK[part.tone] > RANK[tone] ? part.tone : tone), 'muted');

/** A verdict; `detail`, when given, replaces the part's description with what is wrong. */
const is = (tone: Tone, state: string, detail?: string) => ({
  tone,
  state,
  ...(detail ? { detail } : {}),
});

/** A failure share past these is a warning, then an outage. */
const rateTone = (failed: number, total: number): Tone =>
  total === 0 || failed === 0
    ? 'success'
    : failed / total >= 0.2
      ? 'destructive'
      : failed / total >= 0.05
        ? 'warning'
        : 'success';

/**
 * Every part this console can see, with a verdict on each. `undefined` inputs are still loading:
 * their parts read "Checking" in grey rather than a guess.
 */
export function partsOf({
  health,
  healthFailed,
  system,
  systemFailed,
  overview,
  usage,
}: {
  health: Health | undefined;
  healthFailed: boolean;
  system: SystemState | undefined;
  systemFailed: boolean;
  overview: Overview | undefined;
  usage: Usage | undefined;
}): Part[] {
  const checking = is('muted', 'Checking');
  const integration = (name: string) => overview?.integrations.find((item) => item.name === name);
  const redis = system?.redis;
  const queues = redis && 'queues' in redis ? redis.queues : [];
  const failedJobs = queues.reduce((total, queue) => total + queue.failed, 0);
  const outbox = system?.outbox;
  const { ai, email, push } = usage ?? {};
  const stripe = integration('Stripe');
  const webhook = integration('Stripe webhook');
  const storage = integration('Object storage');
  const sentry = integration('Sentry');

  const api = healthFailed
    ? is('destructive', 'Down')
    : !health
      ? checking
      : health.status === 'ok'
        ? is('success', `Up ${span(health.uptimeSeconds)}`)
        : is('warning', 'Degraded');

  const database = healthFailed
    ? is('destructive', 'Unknown')
    : !health
      ? checking
      : health.checks.database === 'up'
        ? is('success', 'Connected')
        : is('destructive', 'Unreachable');

  const cache = systemFailed
    ? is('destructive', 'Unreadable')
    : !redis
      ? checking
      : !redis.configured
        ? is('muted', 'Off')
        : 'pingMs' in redis
          ? is('success', `${redis.pingMs} ms`)
          : is('destructive', 'Unreachable', redis.error ?? 'No answer');

  const jobs = systemFailed
    ? is('destructive', 'Unreadable')
    : !outbox
      ? checking
      : outbox.deadLettered > 0
        ? is(
            'destructive',
            `${formatCount(outbox.deadLettered)} dead`,
            'Jobs the outbox gave up on',
          )
        : failedJobs > 0
          ? is('warning', `${formatCount(failedJobs)} failed`)
          : outbox.pending > BACKLOG
            ? is('warning', `${formatCount(outbox.pending)} queued`, 'The worker is behind')
            : is('success', 'Clear');

  const model = !ai
    ? checking
    : !ai.configured
      ? is('muted', 'Off', 'No AI_API_KEY')
      : is(
          rateTone(ai.errors, ai.requests),
          ai.errors ? `${percent(ai.errors, ai.requests)}% failing` : 'Answering',
        );

  const mail = !email
    ? checking
    : !email.configured
      ? is('muted', 'Off', 'No RESEND_API_KEY')
      : is(
          rateTone(email.failed, email.sent + email.failed),
          email.failed ? `${formatCount(email.failed)} failed` : 'Sending',
        );

  const phones = !push
    ? checking
    : is(
        rateTone(push.failed, push.sent + push.failed),
        push.failed ? `${formatCount(push.failed)} failed` : 'Sending',
      );

  return [
    { key: 'api', name: 'API', icon: Pulse, detail: 'Every request from the apps', ...api },
    { key: 'database', name: 'Database', icon: Database, detail: 'Every record', ...database },
    { key: 'redis', name: 'Redis', icon: Zap, detail: 'Rate limits and the job queue', ...cache },
    { key: 'jobs', name: 'Jobs', icon: Layers, detail: 'Reminders and background work', ...jobs },
    {
      key: 'ai',
      name: 'Ask Garaj',
      icon: Bot,
      detail: ai?.model ?? 'The model behind Ask',
      ...model,
    },
    { key: 'email', name: 'Email', icon: Mail, detail: 'Reminders, by Resend', ...mail },
    {
      key: 'push',
      name: 'Push',
      icon: Smartphone,
      detail: 'Reminders on phones, by Expo',
      ...phones,
    },
    {
      key: 'storage',
      name: 'Storage',
      icon: HardDrive,
      detail: 'Photos and documents',
      ...(!storage
        ? checking
        : storage.on
          ? is('success', 'Ready')
          : is('warning', 'Off', 'Uploads have nowhere to go')),
    },
    {
      key: 'billing',
      name: 'Billing',
      icon: CreditCard,
      detail: 'Stripe checkout and plans',
      ...(!stripe
        ? checking
        : !stripe.on
          ? is('muted', 'Off')
          : webhook?.on
            ? is('success', 'Live')
            : is('warning', 'No webhook', 'Plan changes from Stripe will not arrive')),
    },
    {
      key: 'monitoring',
      name: 'Monitoring',
      icon: Radar,
      detail: 'Error reports, by Sentry',
      ...(!sentry ? checking : sentry.on ? is('success', 'Reporting') : is('muted', 'Off')),
    },
  ];
}

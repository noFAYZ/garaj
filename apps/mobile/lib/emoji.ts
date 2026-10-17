import type { EventType, NotificationType } from '@vehicle-os/domain';

/**
 * The glyph for each kind of entry, as system emoji.
 *
 * The web draws the same vocabulary with inlined Fluent Emoji; a phone already ships an emoji font
 * that is recognisable at 20pt, so these are the characters themselves — no SVG renderer and no
 * download. The mapping is the web's, entry for entry.
 */
const EVENT: Partial<Record<EventType, string>> = {
  MAINTENANCE: '🧰',
  REPAIR: '🛠️',
  FUEL: '⛽',
  CHARGE: '🔌',
  PURCHASE: '🧾',
  INSPECTION: '🔍',
  MODIFICATION: '⚙️',
  CLEANING: '🧼',
  REGISTRATION: '📋',
  INSURANCE: '🛡️',
  TRIP: '🗺️',
  ACCIDENT: '💥',
  EXPENSE: '💸',
  NOTE: '📝',
};

export const eventEmoji = (type: EventType): string => EVENT[type] ?? '📝';

/** A schedule's job, from the whole words in its title; no match keeps the toolbox. */
const JOBS: readonly [readonly string[], string][] = [
  [['oil'], '🛢️'],
  [['tyre', 'tyres', 'tire', 'tires', 'wheel', 'wheels'], '🛞'],
  [['brake', 'brakes'], '🛑'],
  [['chain', 'belt'], '⛓️'],
  [['battery', 'batteries'], '🔋'],
  [['filter', 'filters', 'air'], '🌬️'],
  [['coolant', 'antifreeze', 'radiator'], '❄️'],
  [['spark', 'plug', 'plugs', 'ignition'], '⚡'],
  [['inspection', 'inspect', 'mot', 'test'], '🔍'],
  [['clean', 'cleaning', 'wash', 'valet'], '🧼'],
  [['insurance'], '🛡️'],
  [['registration', 'tax'], '📋'],
];

export function jobEmoji(title: string): string {
  const words = new Set(title.toLowerCase().split(/[^a-z]+/));
  return JOBS.find(([keywords]) => keywords.some((word) => words.has(word)))?.[1] ?? '🧰';
}

type NoticeTone = 'destructive' | 'warning' | 'neutral';

/** Each kind of notification: its glyph, its name in a word or two, and how loud it is. */
export const NOTICE: Record<NotificationType, { emoji: string; label: string; tone: NoticeTone }> =
  {
    MAINTENANCE_DUE: { emoji: '🧰', label: 'Service due', tone: 'warning' },
    MAINTENANCE_OVERDUE: { emoji: '🧰', label: 'Overdue', tone: 'destructive' },
    TASK_DUE: { emoji: '🗓️', label: 'Task due', tone: 'warning' },
    TASK_OVERDUE: { emoji: '🗓️', label: 'Task late', tone: 'destructive' },
    DOCUMENT_EXPIRING: { emoji: '📝', label: 'Expiring', tone: 'warning' },
    REGISTRATION_EXPIRING: { emoji: '📋', label: 'Registration', tone: 'warning' },
    INSURANCE_EXPIRING: { emoji: '🛡️', label: 'Insurance', tone: 'warning' },
    WARRANTY_EXPIRING: { emoji: '🧾', label: 'Warranty', tone: 'warning' },
    HEALTH_CHANGED: { emoji: '🔍', label: 'Health', tone: 'neutral' },
    GARAGE_BRIEFING: { emoji: '📝', label: 'Briefing', tone: 'neutral' },
    MEMBER_INVITED: { emoji: '📝', label: 'Invite', tone: 'neutral' },
    RECALL: { emoji: '⚠️', label: 'Possible recall', tone: 'warning' },
  };

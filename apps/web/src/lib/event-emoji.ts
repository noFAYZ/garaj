import type { EventType } from '@vehicle-os/domain';
import type { EmojiName } from '@/components/emoji';

/**
 * Which emoji marks an entry on the rail.
 *
 * A line-art set drew a fill-up, a repair and an insurance payment with almost the same spanner;
 * these are different from one another at 22px, which is what makes a long record skimmable. A
 * type with no obvious emoji takes the note, rather than borrowing a spanner and claiming a note
 * was a service.
 */
const EVENT_EMOJI: Partial<Record<EventType, EmojiName>> = {
  MAINTENANCE: 'maintenance',
  REPAIR: 'repair',
  FUEL: 'fuel',
  CHARGE: 'charge',
  PURCHASE: 'purchase',
  INSPECTION: 'inspection',
  MODIFICATION: 'modification',
  CLEANING: 'cleaning',
  REGISTRATION: 'registration',
  INSURANCE: 'insurance',
  TRIP: 'trip',
  ACCIDENT: 'accident',
  EXPENSE: 'expense',
  NOTE: 'note',
};

export const eventEmoji = (type: EventType): EmojiName => EVENT_EMOJI[type] ?? 'note';

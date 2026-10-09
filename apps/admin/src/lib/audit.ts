import { KeyRound, Minus, Pencil, Plus, Shield, type LucideIcon } from 'lucide-react';
import type { ChipTone } from '../components/ui';

/*
 * An audit action is `resource.verb` (`garage.vehicle_drivers_assigned`), or `admin.` and then that
 * for a change made from this console. The verb decides the colour a row wears: green for
 * something new, blue for a change, red for something gone, copper for the console's own hand.
 */

export interface Verb {
  kind: 'create' | 'change' | 'remove' | 'access' | 'console';
  label: string;
  tone: ChipTone;
  icon: LucideIcon;
  /** The rule down a row's left edge, as a colour. */
  rule: string;
}

const CREATE = /(^|_)(created|added|uploaded|invited|joined|shared|restored|granted)$/;
const REMOVE = /(^|_)(deleted|removed|revoked|archived|left|expired|unshared)$/;
const ACCESS = /^(api_key|session|auth|share)\./;

export function verbOf(action: string): Verb {
  if (action.startsWith('admin.')) {
    return {
      kind: 'console',
      label: 'Console',
      tone: 'ink',
      icon: Shield,
      rule: 'var(--color-primary)',
    };
  }
  const verb = action.split('.').at(-1) ?? '';
  if (REMOVE.test(verb)) {
    return {
      kind: 'remove',
      label: 'Removed',
      tone: 'destructive',
      icon: Minus,
      rule: 'var(--color-destructive)',
    };
  }
  if (CREATE.test(verb)) {
    return {
      kind: 'create',
      label: 'Added',
      tone: 'success',
      icon: Plus,
      rule: 'var(--color-success)',
    };
  }
  if (ACCESS.test(action)) {
    return {
      kind: 'access',
      label: 'Access',
      tone: 'warning',
      icon: KeyRound,
      rule: 'var(--color-warning)',
    };
  }
  return {
    kind: 'change',
    label: 'Changed',
    tone: 'info',
    icon: Pencil,
    rule: 'var(--color-info)',
  };
}

/** `garage.vehicle_drivers_assigned` as its two halves: what it is about, and what happened. */
export function splitAction(action: string): { scope: string; what: string } {
  const bare = action.replace(/^admin\./, '');
  const at = bare.indexOf('.');
  return at === -1
    ? { scope: '', what: bare }
    : { scope: bare.slice(0, at + 1), what: bare.slice(at + 1) };
}

/** Where an entry's subject lives in the console — unless the entry is it being deleted. */
export function subjectHref(entry: {
  action: string;
  resourceType: string;
  resourceId: string | null;
  garageId: string | null;
}): string | null {
  const gone = entry.action.endsWith('.deleted');
  if (entry.resourceType === 'user' && entry.resourceId)
    return gone ? null : `#/users/${entry.resourceId}`;
  if (entry.resourceType === 'garage' && entry.resourceId)
    return gone ? null : `#/garages/${entry.resourceId}`;
  if (entry.garageId) return `#/garages/${entry.garageId}`;
  return null;
}

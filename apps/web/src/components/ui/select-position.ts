/**
 * The select's geometry and keyboard rules as plain functions: no DOM and no React, so the
 * parts most likely to be subtly wrong can be tested directly.
 */

export interface TriggerRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

export interface ListPlacement {
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
  /** Opened above the trigger, so it grows from its bottom edge. */
  readonly up: boolean;
}

/** Between the trigger and the list. */
const GAP = 6;
/** Kept clear of the viewport's edges. */
const EDGE = 8;
/** Beyond this the list scrolls; a list taller than half a phone is a page, not a menu. */
const MAX_HEIGHT = 320;
/** Never squeezed below this — five rows — even when both sides are cramped. */
const MIN_HEIGHT = 120;

/**
 * Where the list goes: below the trigger, unless it does not fit there and there is more room
 * above. Its height is capped by the room on the side it opens toward, so a long list scrolls
 * rather than running off the screen, and it is pulled back inside the right edge when the
 * trigger sits near it.
 */
export function placeList(
  trigger: TriggerRect,
  list: { readonly height: number; readonly width: number },
  viewport: { readonly width: number; readonly height: number },
  /** A taller cap for a panel that is not a list — a calendar should open whole, not scroll. */
  cap = MAX_HEIGHT,
): ListPlacement {
  const below = viewport.height - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  const wanted = Math.min(list.height, cap);
  const up = below < wanted && above > below;
  const maxHeight = Math.min(cap, Math.max(MIN_HEIGHT, up ? above : below));
  const height = Math.min(wanted, maxHeight);
  const width = Math.max(list.width, trigger.width);

  return {
    up,
    maxHeight,
    top: up ? trigger.top - GAP - height : trigger.bottom + GAP,
    left: Math.max(EDGE, Math.min(trigger.left, viewport.width - width - EDGE)),
  };
}

/**
 * The option an arrow key lands on, stepping over disabled ones and wrapping at the ends.
 * `from` of -1 means nothing is active yet: down starts at the first option, up at the last.
 * Returns -1 when every option is disabled.
 */
export function nextEnabled(disabled: readonly boolean[], from: number, delta: 1 | -1): number {
  const count = disabled.length;
  const start = from < 0 ? (delta === 1 ? -1 : count) : from;
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + delta * step) % count) + count) % count;
    if (!disabled[index]) return index;
  }
  return -1;
}

/**
 * Type-to-find, the way a native select does it.
 *
 * A single letter jumps to the next option starting with it, so pressing it again cycles
 * through them — as does holding one letter down ("mmm"). A longer prefix ("mop") searches from
 * the current option inclusive, so the option already matching "mo" is not skipped when the "p"
 * arrives. Returns -1 when nothing matches.
 */
export function matchTypeahead(
  labels: readonly string[],
  disabled: readonly boolean[],
  query: string,
  from: number,
): number {
  const needle = query.toLocaleLowerCase();
  const count = labels.length;
  if (count === 0 || needle === '') return -1;

  const repeated = [...needle].every((character) => character === needle[0]);
  const search = repeated ? needle.slice(0, 1) : needle;
  const base = from < 0 ? 0 : repeated ? from + 1 : from;

  for (let step = 0; step < count; step += 1) {
    const index = (base + step) % count;
    if (!disabled[index] && labels[index]?.toLocaleLowerCase().startsWith(search)) return index;
  }
  return -1;
}

/**
 * Shared easing curves, referenced by the vendored beUI components.
 *
 * Kept at this exact path because a later `shadcn add` writes imports pointing here — moving
 * the file means hand-editing every future component pull.
 */

/** Decelerating. For things entering: a panel opening, a toast arriving. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Symmetric. For things that move without arriving or leaving: a toggle, a tab indicator. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

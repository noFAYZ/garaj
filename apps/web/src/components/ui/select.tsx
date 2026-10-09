'use client';

import { Check, ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { matchTypeahead, nextEnabled, placeList } from './select-position';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /**
   * Shown before the label, in the list and on the trigger. Decorative: the label still says
   * everything the option means, so an icon that fails to load costs nothing.
   */
  readonly icon?: ReactNode;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  /**
   * What the control chooses, for a screen reader. The trigger's visible text is the current
   * value, so without a name it announces "Kilometres, combobox" and never says of what.
   */
  ariaLabel?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** For a `<label htmlFor>` elsewhere; clicking that label then opens this select. */
  id?: string;
  className?: string;
  /** For a trigger set into a surface that already draws the field, such as a spec-sheet cell. */
  triggerClassName?: string;
}

/** How long typed letters keep adding to one search before it starts over. */
const TYPEAHEAD_MS = 500;

/**
 * A select: a trigger that shows the value, and a list of options.
 *
 * Options come in as data rather than as child components. The compound version registered
 * every item with its parent through state so the trigger could show a label — one parent
 * re-render per option on mount — and kept all of them mounted and animated while closed. A
 * label from children also broke silently: any option whose children were not a plain string
 * showed its raw value, which on the documents form was an event's UUID. From data, the label
 * is one lookup, and options exist only while the list is open.
 *
 * The list is a native popover. That puts it in the top layer, above a modal `<dialog>` it
 * opens from — an absolutely positioned list was clipped by the dialog's scroll box — and gives
 * light dismiss for free: a click outside closes it, and Escape closes the list without also
 * closing the dialog around it.
 *
 * Keyboard follows the select-only combobox pattern: focus stays on the trigger and
 * `aria-activedescendant` points at the active option. Arrows, Home and End move; Enter or
 * Space choose; typing letters jumps to an option, open or closed, as a native select does.
 */
export function Select({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = 'Select',
  disabled = false,
  id,
  className,
  triggerClassName,
}: SelectProps) {
  const baseId = useId();
  const triggerId = id ?? `${baseId}-trigger`;
  const listId = `${baseId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const openAtPointerDown = useRef(false);
  const typed = useRef({ query: '', at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const disabledFlags = options.map((option) => Boolean(option.disabled));

  const show = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onValueChange(option.value);
    setOpen(false);
    // Picking with the pointer must not strand focus: the next Tab continues from here.
    triggerRef.current?.focus({ preventScroll: true });
  };

  /*
   * Opening and closing follow `open` in a layout effect, before paint: the list is shown,
   * filled and positioned in one frame, so it never flashes at the browser's default centred
   * popover position first.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!list || !trigger) return;

    if (!open) {
      if (list.matches(':popover-open')) list.hidePopover();
      return;
    }
    if (!list.matches(':popover-open')) list.showPopover();

    // Written straight to the element's style: following a scroll must not re-render React.
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      list.style.minWidth = `${rect.width}px`;
      const spot = placeList(
        rect,
        // `scrollHeight` is the full height of the options even while `maxHeight` clips it.
        { height: list.scrollHeight, width: list.offsetWidth },
        { width: window.innerWidth, height: window.innerHeight },
      );
      list.style.top = `${spot.top}px`;
      list.style.left = `${spot.left}px`;
      list.style.maxHeight = `${spot.maxHeight}px`;
      list.style.transformOrigin = spot.up ? 'bottom' : 'top';
    };
    // Scrolling the list itself moves nothing; any other scroll — the page, a dialog — may
    // have moved the trigger.
    const onScroll = (event: Event) => {
      if (!list.contains(event.target as Node)) place();
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // A light dismiss (a click outside, Escape) closes the popover natively; this keeps `open` true
  // to that.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') setOpen(false);
    };
    list.addEventListener('toggle', onToggle);
    return () => list.removeEventListener('toggle', onToggle);
  }, []);

  // The active option stays in view as the arrows move through a list longer than its box.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const typeahead = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return -1;
    const recent = event.timeStamp - typed.current.at < TYPEAHEAD_MS;
    typed.current = {
      query: recent ? typed.current.query + event.key : event.key,
      at: event.timeStamp,
    };
    return matchTypeahead(
      options.map((option) => option.label),
      disabledFlags,
      typed.current.query,
      open ? active : selectedIndex,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        show(
          selectedIndex >= 0
            ? selectedIndex
            : nextEnabled(disabledFlags, -1, key === 'ArrowUp' ? -1 : 1),
        );
        return;
      }
      // Closed, a letter changes the value directly — what a native select does.
      const match = typeahead(event);
      if (match >= 0 && options[match]?.value !== value) onValueChange(options[match]!.value);
      return;
    }

    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => nextEnabled(disabledFlags, current, key === 'ArrowDown' ? 1 : -1));
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        setActive(nextEnabled(disabledFlags, -1, key === 'Home' ? 1 : -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Tab':
        setOpen(false);
        return;
      // Escape is left to the popover: its close watcher closes the list and nothing behind it.
    }

    const match = typeahead(event);
    if (match >= 0) setActive(match);
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={() => {
          /*
           * A press on the trigger is outside the popover, so light dismiss closes the list
           * before this button's click arrives — and the click would open it again. Whether it
           * was open when the press began is what the click has to go on.
           */
          openAtPointerDown.current = listRef.current?.matches(':popover-open') ?? false;
        }}
        onClick={() => {
          if (openAtPointerDown.current || open) {
            openAtPointerDown.current = false;
            setOpen(false);
            return;
          }
          show(selectedIndex >= 0 ? selectedIndex : nextEnabled(disabledFlags, -1, 1));
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-input px-3 text-left text-sm transition-colors',
          'hover:bg-border aria-expanded:bg-border',
          'disabled:pointer-events-none disabled:opacity-50',
          triggerClassName,
        )}
      >
        <span
          className={cn(
            'flex min-w-0 items-center gap-2',
            selected ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {selected?.icon}
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-aria-expanded:rotate-180"
        />
      </button>

      {/*
       * No display utility on this element: the browser hides a closed popover with
       * `display: none`, and a `flex` or `block` class would override that and leave it showing.
       * `animate-pop` replays on every open, because leaving `display: none` restarts it.
       */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        popover="auto"
        aria-label={ariaLabel}
        // Keeps focus on the trigger while an option is clicked, so the combobox never blurs.
        onMouseDown={(event) => event.preventDefault()}
        className="m-0 max-w-[min(24rem,calc(100vw-1rem))] animate-pop overflow-y-auto overscroll-contain rounded-xl border-0 bg-popover p-1 text-foreground shadow-float [inset:auto]"
      >
        {open
          ? options.map((option, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  // Pointer and keyboard share one highlight, so the two never disagree about
                  // which option Enter would pick.
                  onPointerMove={() => {
                    if (index !== active && !option.disabled) setActive(index);
                  }}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    index === active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    isSelected && 'font-semibold text-foreground',
                    option.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon}
                    <span className="min-w-0 truncate">{option.label}</span>
                  </span>
                  {isSelected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

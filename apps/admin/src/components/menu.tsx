import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';

/*
 * The console's dropdown: one panel for a row's ⋯, a toolbar's sort, the account menu.
 *
 * A native `popover`, so it sits in the top layer — above a sheet's modal dialog, where a portal
 * to `body` would be inert — and the browser handles the outside click and Escape. The panel
 * stays next to its trigger in the DOM, so Tab from the trigger walks into it and on out. It is
 * placed against the trigger when it opens (flipped up when there is no room below) and follows
 * the trigger while the page scrolls under it.
 */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** Right-aligned: a shortcut, a count, a note. */
  hint?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** A choice among several: drawn with a check, announced as a radio item. */
  checked?: boolean;
  onSelect: () => void;
}

export interface MenuSection {
  label?: string;
  items: (MenuItem | false | null | undefined)[];
}

export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const GAP = 6;
const EDGE = 8;

export function Menu({
  label,
  trigger,
  sections,
  header,
  align = 'end',
  width = 232,
  className,
}: {
  /** What the menu is, for a screen reader: "Actions for Bob Tester". */
  label: string;
  trigger: (props: TriggerProps) => ReactNode;
  sections: MenuSection[];
  /** Something above the items: who is signed in, the theme picker. */
  header?: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openAtPointerDown = useRef(false);
  const [open, setOpen] = useState(false);

  const place = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const height = panel.offsetHeight;
    const below = anchor.bottom + GAP + height <= window.innerHeight - EDGE;
    const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - height);
    const left = Math.min(
      Math.max(EDGE, align === 'end' ? anchor.right - width : anchor.left),
      window.innerWidth - width - EDGE,
    );
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.transformOrigin = `${align === 'end' ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;
  }, [align, width]);

  const items = () => [
    ...(panelRef.current?.querySelectorAll<HTMLElement>('[data-item]:not([disabled])') ?? []),
  ];

  const show = (focusFirst: boolean) => {
    const panel = panelRef.current;
    if (!panel || panel.matches(':popover-open')) return;
    panel.showPopover();
    // Measured and placed in the same task as it is shown, so it never paints anywhere else.
    place();
    (focusFirst ? items()[0] : panel)?.focus({ preventScroll: true });
  };
  const hide = () => {
    const panel = panelRef.current;
    if (panel?.matches(':popover-open')) panel.hidePopover();
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open');
    panel.addEventListener('toggle', onToggle);
    return () => panel.removeEventListener('toggle', onToggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const triggerProps: TriggerProps = {
    ref: triggerRef,
    id: `${id}-trigger`,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': id,
    // A press on the trigger is outside the panel, so the browser closes it before the click
    // lands; remembering it was open stops the click from opening it straight back up.
    onPointerDown: () => {
      openAtPointerDown.current = Boolean(panelRef.current?.matches(':popover-open'));
    },
    onClick: (event) => {
      if (openAtPointerDown.current) {
        openAtPointerDown.current = false;
        return;
      }
      if (panelRef.current?.matches(':popover-open')) hide();
      // `detail` is 0 for Enter or Space: a keyboard opening starts on the first item.
      else show(event.detail === 0);
    },
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        show(true);
      }
    },
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => list[(index + list.length) % list.length]?.focus();
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at === -1 ? -1 : at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
    else if (event.key === 'Tab') return hide();
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Type-ahead: the next item starting with that letter.
      const letter = event.key.toLowerCase();
      const next = [...list.slice(at + 1), ...list.slice(0, at + 1)].find((item) =>
        item.textContent?.trim().toLowerCase().startsWith(letter),
      );
      next?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <>
      {trigger(triggerProps)}
      <div
        ref={panelRef}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onPanelKey}
        style={{ width }}
        className={cn(
          'menu-panel m-0 max-h-[min(26rem,calc(100dvh-1rem))] overflow-y-auto rounded-2xl bg-popover p-1.5 text-foreground shadow-float outline-none [inset:auto] [scrollbar-width:thin]',
          className,
        )}
      >
        {header}
        {sections.map((section, s) => {
          const shown = section.items.filter((item): item is MenuItem => Boolean(item));
          if (!shown.length) return null;
          return (
            <div
              key={s}
              role="group"
              aria-label={section.label}
              className={cn(s > 0 && 'mt-1 border-t border-border/60 pt-1')}
            >
              {section.label ? (
                <p className="px-2.5 pb-1 pt-1.5 text-label uppercase text-muted-foreground">
                  {section.label}
                </p>
              ) : null}
              {shown.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  data-item=""
                  role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    hide();
                    item.onSelect();
                  }}
                  className={cn(
                    'group/item flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm font-medium outline-none transition-colors duration-75 disabled:pointer-events-none disabled:opacity-45',
                    item.destructive
                      ? 'text-destructive hover:bg-destructive-soft focus-visible:bg-destructive-soft'
                      : 'text-foreground hover:bg-muted focus-visible:bg-muted',
                  )}
                >
                  {item.icon ? (
                    <item.icon
                      className={cn(
                        'size-4 shrink-0 transition-transform duration-150 group-hover/item:scale-110',
                        item.destructive
                          ? ''
                          : 'text-muted-foreground group-hover/item:text-foreground',
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                  ) : null}
                  {item.checked ? (
                    <Check
                      className="size-4 shrink-0 text-primary"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A choice from a short list, as a pill that says what is chosen: "Sort · Newest first". */
export function SelectMenu<T extends string>({
  label,
  value,
  onChange,
  options,
  icon: Glyph,
  align = 'end',
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; hint?: ReactNode }[];
  icon?: LucideIcon;
  align?: 'start' | 'end';
}) {
  const current = options.find((option) => option.value === value) ?? options[0]!;
  return (
    <Menu
      label={label}
      align={align}
      width={220}
      sections={[
        {
          items: options.map((option) => ({
            label: option.label,
            hint: option.hint,
            checked: option.value === value,
            onSelect: () => onChange(option.value),
          })),
        },
      ]}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`${label}: ${current.label}`}
          className="group flex h-10 shrink-0 items-center gap-2 rounded-full bg-muted/80 pl-3.5 pr-3 text-sm transition-[background-color,scale] duration-100 hover:bg-muted active:scale-[0.97] aria-expanded:bg-muted"
        >
          {Glyph ? <Glyph className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold">{current.label}</span>
          <ChevronDown
            className="size-3.5 text-muted-foreground transition-transform duration-150 group-aria-expanded:rotate-180"
            aria-hidden="true"
          />
        </button>
      )}
    />
  );
}

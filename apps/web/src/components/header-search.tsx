'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Icon } from '@/components/icons';
import { SEARCH_KINDS } from '@/lib/search-kinds';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';

/**
 * Search in the header, as a combobox.
 *
 * A real combobox rather than an input beside a list: the ARIA pattern is what makes the
 * arrow keys move through results while focus stays in the box, and what tells a screen
 * reader that typing changes the list below. Rolling it as a div with a click handler gets
 * the look and none of that.
 *
 * Everything else here is about not fighting the user: the query is debounced so a
 * five-letter word is one request rather than five, Escape closes without clearing, and
 * Enter with nothing highlighted falls through to the full search page — which still exists
 * and is better for a long list.
 */
export function HeaderSearch() {
  const router = useRouter();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * `/` and ⌘K / Ctrl+K jump to the box from anywhere. `/` is ignored while typing in another
   * field — otherwise nobody could write a date or a fraction in a form. ⌘K is not: it is not a
   * character anyone types, and browsers claim it for their own search if it is not taken.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      const commandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!commandK && (event.key !== '/' || typing)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /*
   * A phone has no room for a field beside the navigation, so there it is a magnifier until it
   * takes focus; then the field takes the logo's and the navigation's place (the shell hides them
   * on `data-search="open"`), with a way back out. The input is always mounted: the magnifier
   * focuses it inside the tap, which is what lets iOS raise the keyboard.
   *
   * In the row's flow, not laid over it: the bell and the account stay exactly where they were, so
   * their popovers' surfaces, drawn in a portal above everything, stay under them.
   */
  const [expanded, setExpanded] = useState(false);

  // 200ms: below it the list flickers through states nobody reads, above it the box feels
  // like it is lagging behind the keyboard.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 200);
    return () => clearTimeout(timer);
  }, [term]);

  const search = useQuery({ ...searchQuery(api, debounced, { limit: 6 }), staleTime: 30_000 });
  const results = search.data?.results ?? [];

  // A click anywhere else closes it. Pointerdown rather than click, so choosing a result is
  // not cancelled by the close that a later click event would trigger first.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setExpanded(false);
    setTerm('');
    router.push(href);
  };

  const collapse = () => {
    setOpen(false);
    setExpanded(false);
    setTerm('');
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setExpanded(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The list is the thing being navigated, not the page behind it.
      event.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActive((current) => {
        const next = current + (event.key === 'ArrowDown' ? 1 : -1);
        return (next + results.length) % results.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      const chosen = results[active];
      if (chosen) {
        event.preventDefault();
        go(SEARCH_KINDS[chosen.type].href(chosen));
      } else if (term.trim().length >= 2) {
        event.preventDefault();
        go(`/search?q=${encodeURIComponent(term.trim())}`);
      }
    }
  };

  return (
    <>
      {/* The phone's way in. `ml-auto` sends it to the right with the bell and the account. */}
      {expanded ? null : (
        <button
          type="button"
          aria-label="Search"
          onClick={() => inputRef.current?.focus()}
          className={buttonClass('ghost', 'icon', 'ml-auto -mr-1 rounded-full sm:hidden')}
        >
          <Search className="size-[1.125rem]" aria-hidden="true" />
        </button>
      )}
      {/*
       * From `sm`, capped rather than fixed: `flex-1` with a `max-w` step gives up width before
       * the account button is pushed off the edge. On a phone, a point out of the flow until
       * focused, then everything left of the bell.
       */}
      <div
        ref={containerRef}
        data-search={expanded ? 'open' : undefined}
        className={cn(
          // `transition-none`: under reduced motion every element gets a 0.01ms `all`
          // transition, and a frame of flex-grow easing up from 0 is enough for the bell's
          // popover to measure it out of place and stay there.
          'min-w-0 transition-none sm:relative sm:ml-auto sm:flex sm:max-w-52 sm:flex-1 lg:max-w-64',
          expanded
            ? 'max-sm:flex max-sm:flex-1 max-sm:items-center max-sm:gap-3'
            : 'max-sm:absolute max-sm:size-0 max-sm:overflow-hidden',
        )}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            aria-label="Search your garage"
            placeholder="Search…"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              setExpanded(true);
            }}
            onKeyDown={onKeyDown}
            /*
             * The field answers focus itself, by lifting off the header rather than being
             * outlined: a search box is the one control where the state is worth showing on
             * the surface, because the panel that opens beneath it belongs to that state.
             */
            className="peer h-9 w-full rounded-full bg-input pl-9 pr-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:bg-border focus:bg-border sm:pr-9"
          />
          {/*
           * The shortcut, shown only while the box is idle — empty and unfocused — so it never
           * sits on top of what someone is typing. `/` rather than ⌘K: it is one key on every
           * platform, so the hint needs no guess about the reader's keyboard.
           */}
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 hidden h-5 min-w-5 -translate-y-1/2 place-items-center rounded-md bg-background/60 px-1 font-sans text-xs font-semibold text-muted-foreground peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden sm:grid"
          >
            /
          </kbd>

          {open && debounced.trim().length >= 2 ? (
            <div className="absolute left-0 top-11 z-30 w-[calc(100vw-2rem)] animate-pop overflow-hidden rounded-2xl bg-popover shadow-float sm:left-auto sm:right-0 sm:w-[min(22rem,calc(100vw-2rem))]">
              {search.isPending ? (
                <div className="flex flex-col gap-2 p-3" role="status" aria-label="Searching">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : results.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing matches “{debounced}”.</p>
              ) : (
                <ul
                  id={listId}
                  role="listbox"
                  aria-label="Search results"
                  className="max-h-80 overflow-y-auto overscroll-contain p-1.5"
                >
                  {results.map((result, index) => (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        type="button"
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(SEARCH_KINDS[result.type].href(result))}
                        className={`group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                          index === active ? 'bg-muted' : ''
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-9 shrink-0 place-items-center rounded-lg transition-colors ${
                            index === active
                              ? 'bg-primary-soft text-foreground'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon name={SEARCH_KINDS[result.type].icon} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">
                            {result.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {SEARCH_KINDS[result.type].label}
                            {result.vehicleName ? ` · ${result.vehicleName}` : ''}
                            {result.subtitle ? ` · ${result.subtitle}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/*
               * The full results page, as a visible target. Enter already goes there, but a phone
               * keyboard's "Go" is not something anyone thinks to press in a dropdown.
               */}
              {search.isPending ? null : (
                <button
                  type="button"
                  onClick={() => go(`/search?q=${encodeURIComponent(debounced.trim())}`)}
                  className="flex h-10 w-full items-center justify-between gap-3 bg-muted/50 px-4 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="min-w-0 truncate">All results for “{debounced.trim()}”</span>
                  <kbd aria-hidden="true" className="hidden font-sans sm:inline">
                    ↵
                  </kbd>
                </button>
              )}
            </div>
          ) : null}
        </div>

        {expanded ? (
          <button
            type="button"
            onClick={collapse}
            className="shrink-0 text-sm font-semibold text-foreground sm:hidden"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );
}

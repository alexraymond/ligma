'use client';

/**
 * The Library's one browsing shell: a filterable, keyboard-navigable list pane
 * beside a detail pane.
 *
 * All three catalogs (design systems, skills, craft rules) render through this
 * so the browsing gesture is identical whichever one you are in — the pattern
 * open-design's design-system tab used, which is the reason its catalog stayed
 * usable at 150 entries (parity OD-068). The list is a real `listbox`: type to
 * filter, arrows to move, Home/End to jump.
 */

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Star } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type CatalogEntry, filterEntries, moveSelection, reconcileSelection } from './catalog';

export interface MasterDetailProps {
  entries: CatalogEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Accessible name for the filter box and the list, e.g. "design systems". */
  noun: string;
  loading?: boolean;
  emptyMessage?: string;
  /** Facet pills, a "Create your own" card, or anything else above the filter box. */
  aboveFilter?: ReactNode;
  /** When set, every row gets a bookmark star (OD-157) reflecting this. */
  isSaved?: (id: string) => boolean;
  onToggleSave?: (id: string) => void;
  children: ReactNode;
}

export function MasterDetail({
  entries,
  selectedId,
  onSelect,
  noun,
  loading = false,
  emptyMessage = 'Nothing here yet.',
  aboveFilter,
  isSaved,
  onToggleSave,
  children,
}: MasterDetailProps) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterEntries(entries, query), [entries, query]);
  const ids = useMemo(() => visible.map((entry) => entry.id), [visible]);

  // A narrowing filter must not leave the detail pane showing a row that is no
  // longer in the list.
  useEffect(() => {
    const next = reconcileSelection(ids, selectedId);
    if (next !== null && next !== selectedId) onSelect(next);
  }, [ids, selectedId, onSelect]);

  function onKeyDown(event: React.KeyboardEvent) {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    let next: string | null = null;
    if (delta !== 0) next = moveSelection(ids, selectedId, delta);
    else if (event.key === 'Home') next = ids[0] ?? null;
    else if (event.key === 'End') next = ids[ids.length - 1] ?? null;
    else return;

    event.preventDefault();
    if (next !== null) {
      onSelect(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-2">
        {aboveFilter}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Filter ${noun}…`}
            aria-label={`Filter ${noun}`}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label={noun}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="max-h-[32rem] overflow-y-auto rounded-xl border bg-card p-1"
        >
          {loading ? (
            <div className="space-y-1 p-1">
              {Array.from({ length: 6 }).map((_, n) => (
                <Skeleton key={n} className="h-10 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {entries.length === 0 ? emptyMessage : `No ${noun} match “${query}”.`}
            </p>
          ) : (
            visible.map((entry) => (
              <div
                key={entry.id}
                className={`group flex w-full items-start gap-1 rounded-lg pr-1 transition-colors ${
                  entry.id === selectedId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                }`}
              >
                <button
                  type="button"
                  role="option"
                  data-entry-id={entry.id}
                  aria-selected={entry.id === selectedId}
                  onClick={() => onSelect(entry.id)}
                  className="min-w-0 flex-1 px-2.5 py-2 text-left"
                >
                  <span className="block truncate text-xs font-medium">{entry.label}</span>
                  {entry.meta ? (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {entry.meta}
                    </span>
                  ) : null}
                </button>
                {onToggleSave ? (
                  <button
                    type="button"
                    onClick={() => onToggleSave(entry.id)}
                    aria-pressed={isSaved?.(entry.id) ?? false}
                    aria-label={
                      isSaved?.(entry.id)
                        ? `Remove ${entry.label} from Saved`
                        : `Save ${entry.label}`
                    }
                    className="mt-1.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${isSaved?.(entry.id) ? 'fill-current text-amber-500' : ''}`}
                    />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

'use client';

/**
 * The design-system picker. One component, every place a design system is
 * chosen.
 *
 * It replaces the build-time `CATALOG` constant the Studio shipped in Phase 3 —
 * that file named its own ceiling ("it drifts if someone adds a design system
 * without touching this file") and its own upgrade path ("a
 * `GET /api/design-systems` route reading the same directory"). This is that
 * upgrade, taken: the options are whatever is on disk right now, and each one
 * carries its own token swatches so you pick by looking rather than by
 * recognising a name.
 *
 * ponytail: the option thumbnail is a swatch strip drawn in plain DOM, not a
 * miniature iframe. Seventeen sandboxed documents inside a popover is a
 * measurable cost for a picture you cannot read at 24px; the Library's detail
 * pane is where the real preview lives. Upgrade path if the popover ever needs
 * true fidelity: `previewSrcdoc` already builds the document.
 *
 * The kickoff composer deliberately has no design-system chip — the shape of a
 * project is not known at kickoff, so the choice belongs at session start
 * (P3-E waiver). This component does not put one there.
 */

import { fetchDesignSystems, filterEntries } from '@/components/library/catalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import type { DesignSystemSummary } from '@ligma/api';
import { Check, Palette } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface DesignSystemPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

/** The catalog fetch, shared by the picker and anything else that needs it. */
export function useDesignSystems(): {
  systems: DesignSystemSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [systems, setSystems] = useState<DesignSystemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchDesignSystems()
      .then((next) => {
        setSystems(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);
  return { systems, loading, error, reload };
}

/** The swatch strip that stands in for a thumbnail. */
export function SwatchStrip({ system }: { system: DesignSystemSummary }) {
  const values = Object.values(system.swatches);
  if (values.length === 0)
    return <span className="h-4 w-10 shrink-0 rounded border border-dashed" aria-hidden />;
  return (
    <span className="flex h-4 shrink-0 overflow-hidden rounded border" aria-hidden>
      {values.map((value, n) => (
        <span key={n} className="w-2.5" style={{ background: value }} />
      ))}
    </span>
  );
}

export function DesignSystemPicker({ value, onChange, disabled }: DesignSystemPickerProps) {
  const { systems, loading, error } = useDesignSystems();
  const [query, setQuery] = useState('');

  const selected = systems.find((system) => system.id === value) ?? null;
  const visible = useMemo(
    () =>
      filterEntries(
        systems.map((system) => ({
          id: system.id,
          label: system.name,
          meta: system.category,
          blurb: system.blurb,
          system,
        })),
        query,
      ),
    [systems, query],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label="Design system">
          <Palette className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {selected?.name ?? value ?? 'Design system'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter design systems…"
          aria-label="Filter design systems"
          className="mb-1 h-7 text-xs"
        />
        <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Design systems">
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={() => onChange(null)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            <span className="w-3.5">
              {value === null ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
            </span>
            None
          </button>

          {loading ? (
            <div className="space-y-1 p-1">
              {Array.from({ length: 5 }).map((_, n) => (
                <Skeleton key={n} className="h-7 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Could not load the catalog: {error}
            </p>
          ) : (
            visible.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={value === entry.id}
                onClick={() => onChange(entry.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span className="w-3.5 shrink-0">
                  {value === entry.id ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                </span>
                <SwatchStrip system={entry.system} />
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                  {entry.meta}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

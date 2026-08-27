'use client';

/**
 * The design switcher in the composer header (roadmap phase 6).
 *
 * Replaces a bare `<select>` that showed titles and nothing else: which design
 * you are about to switch to is a question about how big it is and when you
 * last touched it, and an option element cannot answer that. Same dropdown
 * primitive as the Studio's export menu, so this stays composer-header sized —
 * a gallery *page* would be a second place designs live.
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRelativeTime } from '@/lib/time';
import type { DesignSummary } from '@ligma/api';
import { ChevronDown, Plus } from 'lucide-react';

/** "3 screens · 2h ago", or the honest empty state for a design with no versions yet. */
export function designMeta(design: DesignSummary, now: number = Date.now()): string {
  const screens =
    design.versionCount === 0
      ? 'No versions yet'
      : `${design.files.length} screen${design.files.length === 1 ? '' : 's'}`;
  return `${screens} · ${formatRelativeTime(design.updatedAt, now)}`;
}

export function DesignGallery({
  designs,
  designId,
  onSelect,
  onNew,
}: {
  designs: DesignSummary[];
  designId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const current = designs.find((d) => d.id === designId) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-between px-2 text-xs"
          aria-label="Design"
        >
          <span className="truncate">
            {current?.title ?? (designs.length === 0 ? 'No designs yet' : 'New design')}
          </span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Designs</DropdownMenuLabel>
        {designs.length === 0 ? (
          <DropdownMenuItem disabled>
            Nothing here yet — the next prompt starts one
          </DropdownMenuItem>
        ) : (
          designs.map((design) => (
            <DropdownMenuItem
              key={design.id}
              onSelect={() => onSelect(design.id)}
              className="flex-col items-start gap-0.5"
            >
              <span className="w-full truncate text-xs font-medium">{design.title}</span>
              <span className="text-[11px] text-muted-foreground">{designMeta(design)}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew}>
          <Plus className="mr-2 h-3.5 w-3.5" aria-hidden />
          New design
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

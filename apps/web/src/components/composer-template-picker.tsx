'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PROJECT_KINDS } from '@/lib/composer';
import { Blocks, Globe, type LucideIcon, Server, Terminal, Workflow } from 'lucide-react';

type ProjectKind = (typeof PROJECT_KINDS)[number];

const KIND_ICON: Record<ProjectKind, LucideIcon> = {
  'Web app': Globe,
  'API service': Server,
  'CLI tool': Terminal,
  Library: Blocks,
  Automation: Workflow,
};

/**
 * Re-skin of the reference's radial template picker (OD-024/025) over
 * ligma's fixed 5 project kinds — an icon-first dropdown beside the chip
 * rail, not a hover-tracked SVG wheel with portal-anchored wedges.
 *
 * ponytail: a wedge menu with hover-preview arcs earns its keep when picking
 * from a large, growing template catalog; for 5 static options it's landing-
 * page flash on a productivity tool, and the existing `DropdownMenu`
 * primitive (already used by the Studio's own export menu) does the same job
 * in a fraction of the code. Selecting an item calls the same `onPick`
 * handler the chip rail uses — it is the same 5-way choice, just a second
 * entry point onto it.
 */
export function ComposerTemplatePicker({
  kind,
  onPick,
}: {
  kind: string | null;
  onPick: (kind: ProjectKind) => void;
}) {
  const ActiveIcon = kind !== null && kind in KIND_ICON ? KIND_ICON[kind as ProjectKind] : Blocks;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
          aria-label="Pick a template"
        >
          <ActiveIcon className="h-3.5 w-3.5" aria-hidden />
          {kind ?? 'Template'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PROJECT_KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <DropdownMenuItem key={k} onSelect={() => onPick(k)}>
              <Icon className="mr-2 h-3.5 w-3.5" aria-hidden />
              {k}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

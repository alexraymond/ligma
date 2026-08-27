'use client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useProjects } from '@/hooks/use-data';
import type { Project } from '@ligma/api';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** `/projects/{id}` and anything nested under it; null everywhere else (D-something: same shape as `isProjectSpace` in lib/nav, but this one needs the id). */
export function currentProjectIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Search + order for the switcher's dropdown. Matches the /projects page's own
 * default filter (archived hidden, no toggle here), active projects surfaced
 * first, and a stable sort otherwise — Project has no `updatedAt` to rank by.
 */
export function filterAndSortProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  const visible = projects.filter((p) => p.status !== 'archived');
  const matching = q ? visible.filter((p) => p.name.toLowerCase().includes(q)) : visible;
  return [...matching].sort(
    (a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'),
  );
}

export function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const { projects } = useProjects();

  const currentProjectId = currentProjectIdFromPathname(pathname);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const filtered = filterAndSortProjects(projects, query);

  // ⌘/Ctrl+P toggles the switcher, matching ⌘K for search (search-dialog.tsx).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 shrink-0 gap-2 px-2 text-sm font-medium"
          aria-label="Switch project"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static local asset, no next/image usage elsewhere in the app */}
          <img src="/logo-mark.png" alt="Ligma" className="h-7 w-auto" />
          <span className="max-w-[9rem] truncate">{currentProject?.name ?? 'Ligma'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find a project..." value={query} onValueChange={setQuery} />
          <CommandList>
            {projects.length === 0 ? (
              <CommandGroup>
                <CommandItem onSelect={() => go('/projects?new=1')} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create your first project
                </CommandItem>
              </CommandGroup>
            ) : (
              <>
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup>
                  {filtered.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={project.id}
                      onSelect={() => go(`/projects/${project.id}`)}
                      className="gap-2"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.id === currentProjectId && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup>
              {projects.length > 0 && (
                <CommandItem onSelect={() => go('/projects')}>All projects</CommandItem>
              )}
              <CommandItem onSelect={() => go('/projects?new=1')} className="gap-2">
                <Plus className="h-4 w-4" />
                New project
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

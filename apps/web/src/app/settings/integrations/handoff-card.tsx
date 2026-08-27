'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { Project } from '@ligma/api';
import { ExternalLink, Share2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Handoff menu (OD-104/OD-100): give an external coding agent a running
 * start on one project — either open its repo in the local editor, or copy a
 * compiled prompt (project + open tasks + ligma's workspace snapshot) for
 * pasting into an external agent's chat.
 */

export function HandoffCard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/api/projects');
      if (res.ok) setProjects((await res.json()).projects);
    } catch {
      // Best-effort — the card just keeps showing the last-known list.
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function copyCliPrompt(project: Project) {
    setCopyingId(project.id);
    try {
      const res = await apiFetch(`/api/mcp/handoff-prompt/${project.id}`);
      if (!res.ok) throw new Error('request failed');
      const { prompt } = (await res.json()) as { prompt: string };
      await navigator.clipboard.writeText(prompt);
      toast.success('Prompt copied');
    } catch {
      toast.error('Failed to compile the handoff prompt');
    } finally {
      setCopyingId(null);
    }
  }

  const active = (projects ?? []).filter((p) => !p.deletedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="h-5 w-5" />
          Hand off a project
        </CardTitle>
        <CardDescription className="mt-1.5">
          Open a project&apos;s repo in your editor, or copy a compiled prompt handing its context
          to an external coding agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {projects === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No projects yet.</p>
        ) : (
          active.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{project.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {project.repoPath ?? 'no local repo'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {project.repoPath && (
                  <Button variant="outline" size="sm" className="gap-1.5" asChild>
                    <a href={`vscode://file/${encodeURI(project.repoPath)}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in editor
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyCliPrompt(project)}
                  disabled={copyingId === project.id}
                >
                  {copyingId === project.id ? 'Copying...' : 'Copy CLI prompt'}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

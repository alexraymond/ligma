'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tip';
import { apiFetch } from '@/lib/api-client';
import { Plug, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * External MCP servers registry (OD-101).
 *
 * Registration only — enabling a server here does not launch it or attach it
 * to an agent run. Wiring registered servers into actual agent spawns is a
 * runner concern that is explicitly out of scope for this card.
 *
 * ponytail: editing an existing entry's name/command is not exposed — delete
 * and re-add. Add inline field editing if that friction turns out to matter.
 */

interface McpServerEntry {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

const emptyDraft = {
  name: '',
  transport: 'stdio' as 'stdio' | 'http',
  command: '',
  args: '',
  url: '',
};

export function McpRegistryCard() {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [adding, setAdding] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/api/mcp/servers');
      if (res.ok) setServers((await res.json()).servers);
    } catch {
      // Best-effort — the card just keeps showing the last-known list.
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function addServer() {
    if (!draft.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setAdding(true);
    try {
      const res = await apiFetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          transport: draft.transport,
          command: draft.transport === 'stdio' ? draft.command.trim() || null : null,
          args: draft.transport === 'stdio' ? draft.args.split(/\s+/).filter(Boolean) : [],
          url: draft.transport === 'http' ? draft.url.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? 'Failed to add server');
        return;
      }
      setDraft(emptyDraft);
      await refetch();
      toast.success('Server registered');
    } catch {
      toast.error('Failed to reach the daemon');
    } finally {
      setAdding(false);
    }
  }

  async function toggleEnabled(server: McpServerEntry) {
    try {
      const res = await apiFetch(`/api/mcp/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!res.ok) throw new Error('request failed');
      await refetch();
    } catch {
      toast.error('Failed to reach the daemon');
    }
  }

  async function removeServer(id: string) {
    try {
      const res = await apiFetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('request failed');
      await refetch();
    } catch {
      toast.error('Failed to reach the daemon');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          External MCP servers
        </CardTitle>
        <CardDescription className="mt-1.5">
          Servers ligma&apos;s agents should have access to. Registration only — this does not yet
          wire a server into an actual agent run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {servers === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No external MCP servers registered yet.
          </p>
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
              >
                <Switch checked={server.enabled} onCheckedChange={() => toggleEnabled(server)} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{server.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {server.transport === 'stdio'
                      ? `${server.command} ${server.args.join(' ')}`
                      : server.url}
                  </p>
                </div>
                <Tip content="Remove server">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    aria-label="Remove server"
                    onClick={() => removeServer(server.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_100px]">
            <Input
              placeholder="Server name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8"
            />
            <Select
              value={draft.transport}
              onValueChange={(v) => setDraft({ ...draft, transport: v as 'stdio' | 'http' })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="http">http</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.transport === 'stdio' ? (
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <Input
                placeholder="command (e.g. npx)"
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                className="h-8 font-mono text-xs"
              />
              <Input
                placeholder="args (space-separated)"
                value={draft.args}
                onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                className="h-8 font-mono text-xs"
              />
            </div>
          ) : (
            <Input
              placeholder="http://host:port/mcp"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              className="h-8 font-mono text-xs sm:col-span-2"
            />
          )}
          <Button
            size="sm"
            className="gap-1.5 sm:col-span-2 w-fit"
            onClick={addServer}
            disabled={adding}
          >
            <Plus className="h-3.5 w-3.5" />
            {adding ? 'Adding...' : 'Add server'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

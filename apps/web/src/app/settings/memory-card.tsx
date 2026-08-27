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
import { Brain, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Cross-session agent memory (OD-092).
 *
 * The reference implementation's Memory panel is mostly a "memory model"
 * picker, because over there memories are auto-extracted from transcripts by a
 * second, cheaper model. Ligma has no auto-summarisation — memories are written
 * explicitly, by a human here or by an automation that produced structured
 * output — so there is no extraction model to pick. This card is on/off, the
 * per-agent cap, and the entries themselves instead.
 *
 * Wire shapes are declared locally rather than imported: agents-card.tsx and
 * about-card.tsx already do the same for routes this small, and it keeps the
 * card off `use-daemon.ts`'s `DaemonConfig` (not this feature's file — see the
 * handoff notes) while still round-tripping the whole `execution` block the way
 * settings/page.tsx does.
 *
 * Wired into page.tsx next to `<AgentsCard />`.
 */

interface MemoryEntry {
  id: string;
  text: string;
  source: string | null;
  createdAt: string;
  pinned: boolean;
}

interface AgentRow {
  id: string;
  name: string;
}

interface MemoryKnob {
  enabled: boolean;
  maxEntries: number;
}

const DEFAULT_KNOB: MemoryKnob = { enabled: true, maxEntries: 50 };

export function MemoryCard() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [knob, setKnob] = useState<MemoryKnob>(DEFAULT_KNOB);
  const [capDraft, setCapDraft] = useState(String(DEFAULT_KNOB.maxEntries));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // The whole execution block, kept so a config save can send it back intact —
  // PUT /api/daemon validates `execution` as a complete object.
  const [execution, setExecution] = useState<Record<string, unknown> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon');
      if (!res.ok) return;
      const body = (await res.json()) as { config?: { execution?: Record<string, unknown> } };
      const exec = body.config?.execution ?? null;
      setExecution(exec);
      const memory = exec?.memory as MemoryKnob | undefined;
      setKnob(memory ?? DEFAULT_KNOB);
      setCapDraft(String(memory?.maxEntries ?? DEFAULT_KNOB.maxEntries));
    } catch {
      // Best-effort: the card keeps showing the defaults.
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/agents');
      if (!res.ok) return;
      const body = (await res.json()) as { agents: AgentRow[] };
      setAgents(body.agents);
      setAgentId((current) => current || (body.agents[0]?.id ?? ''));
    } catch {
      // Same — an empty picker says "no agents" well enough.
    }
  }, []);

  const loadEntries = useCallback(async (id: string) => {
    if (!id) {
      setEntries([]);
      return;
    }
    try {
      const res = await apiFetch(`/api/memory/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      setEntries(((await res.json()) as { entries: MemoryEntry[] }).entries);
    } catch {
      toast.error('Failed to reach the daemon');
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadAgents();
  }, [loadConfig, loadAgents]);

  useEffect(() => {
    void loadEntries(agentId);
  }, [agentId, loadEntries]);

  async function saveKnob(next: MemoryKnob) {
    if (!execution) return;
    setKnob(next);
    try {
      const res = await apiFetch('/api/daemon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution: { ...execution, memory: next } }),
      });
      if (!res.ok) throw new Error('save failed');
      await loadConfig();
    } catch {
      toast.error('Failed to save memory settings');
      await loadConfig();
    }
  }

  function commitCap() {
    const parsed = Number.parseInt(capDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
      toast.error('Cap must be between 1 and 500');
      setCapDraft(String(knob.maxEntries));
      return;
    }
    if (parsed === knob.maxEntries) return;
    void saveKnob({ ...knob, maxEntries: parsed });
  }

  async function addEntry() {
    const text = draft.trim();
    if (!text || !agentId) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/memory/${encodeURIComponent(agentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok)
        throw new Error(((await res.json()) as { error?: string }).error ?? 'add failed');
      setDraft('');
      await loadEntries(agentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add memory');
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(entry: MemoryEntry) {
    await apiFetch(`/api/memory/${encodeURIComponent(agentId)}/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !entry.pinned }),
    });
    await loadEntries(agentId);
  }

  async function remove(entry: MemoryEntry) {
    await apiFetch(`/api/memory/${encodeURIComponent(agentId)}/${entry.id}`, { method: 'DELETE' });
    await loadEntries(agentId);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Agent memory
        </CardTitle>
        <CardDescription className="mt-1.5">
          Notes an agent carries between sessions. They are injected into its prompt as &ldquo;What
          you remember&rdquo;, above the task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor="memory-inject" className="flex items-center justify-between gap-2 text-sm">
          <span>Inject memories into agent prompts</span>
          <Switch
            id="memory-inject"
            checked={knob.enabled}
            onCheckedChange={(next) => void saveKnob({ ...knob, enabled: next })}
          />
        </label>

        <label htmlFor="memory-cap" className="flex items-center justify-between gap-2 text-sm">
          <span>Keep at most (per agent)</span>
          <Input
            id="memory-cap"
            type="number"
            min={1}
            max={500}
            className="h-8 w-24"
            value={capDraft}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={commitCap}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>

        <p className="text-xs text-muted-foreground">
          Past the cap the oldest unpinned note is dropped; a pinned note is never evicted. Memories
          are only ever added on purpose — nothing reads a transcript and guesses what to remember,
          so there is no extraction model to choose here. Turning this off stops the injection; the
          notes stay.
        </p>

        <div className="space-y-2 border-t pt-4">
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder={agents.length ? 'Pick an agent' : 'No agents yet'} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="e.g. This product's repo uses pnpm, never npm"
              disabled={!agentId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addEntry();
              }}
            />
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy || !draft.trim() || !agentId}
              onClick={() => void addEntry()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {agentId
                ? 'This agent remembers nothing yet.'
                : 'Pick an agent to see what it remembers.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1 break-words">{entry.text}</span>
                  {entry.source ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {entry.source}
                    </span>
                  ) : null}
                  <Tip content={entry.pinned ? 'Unpin' : 'Pin (never evicted)'}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label={entry.pinned ? 'Unpin' : 'Pin (never evicted)'}
                      onClick={() => void togglePin(entry)}
                    >
                      {entry.pinned ? (
                        <PinOff className="h-3.5 w-3.5" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </Tip>
                  <Tip content="Forget this">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="Forget this"
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

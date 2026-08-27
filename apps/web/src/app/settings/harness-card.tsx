'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api-client';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Acceptance-harness settings (execution.harness) — how much of Alex's own
 * subscription quota the autonomous verification loop is allowed to spend.
 *
 * Wire shape declared locally rather than imported from `use-daemon.ts`'s
 * `DaemonConfig`, same reason as memory-card.tsx / models-card.tsx: that type
 * has no `maxVerificationAttempts` field yet (not this feature's file), and
 * round-tripping the whole `execution` block as a loosely-typed record
 * survives that gap either way.
 *
 * Numeric bounds mirror `apps/daemon/src/engine/config.ts`'s `validateConfig`
 * (also enforced server-side by `daemonConfigUpdateSchema`): a value outside
 * these is silently dropped back to the daemon's current setting rather than
 * erroring, so a UI that allowed more would look saved but not be applied.
 */

interface HarnessBlock {
  autoVerify: boolean;
  maxParallelPersonas: number;
  naiveUserRuns: number;
  maxVerificationAttempts: number;
  judgeModel: string | null;
  personaModel?: string | null;
}

const DEFAULT_HARNESS: HarnessBlock = {
  autoVerify: true,
  maxParallelPersonas: 2,
  naiveUserRuns: 3,
  maxVerificationAttempts: 3,
  judgeModel: null,
};

const BOUNDS = {
  maxParallelPersonas: { min: 1, max: 8, label: 'Max parallel personas' },
  naiveUserRuns: { min: 1, max: 5, label: 'Naive-user runs' },
  maxVerificationAttempts: { min: 1, max: 10, label: 'Max verification attempts' },
} as const;

type NumericField = keyof typeof BOUNDS;

export function HarnessCard() {
  const [execution, setExecution] = useState<Record<string, unknown> | null>(null);
  const [harness, setHarness] = useState<HarnessBlock>(DEFAULT_HARNESS);
  const [drafts, setDrafts] = useState({
    maxParallelPersonas: String(DEFAULT_HARNESS.maxParallelPersonas),
    naiveUserRuns: String(DEFAULT_HARNESS.naiveUserRuns),
    maxVerificationAttempts: String(DEFAULT_HARNESS.maxVerificationAttempts),
  });
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon');
      if (!res.ok) return;
      const body = (await res.json()) as { config?: { execution?: Record<string, unknown> } };
      const exec = body.config?.execution ?? null;
      setExecution(exec);
      const h = (exec?.harness as HarnessBlock | undefined) ?? DEFAULT_HARNESS;
      setHarness(h);
      setDrafts({
        maxParallelPersonas: String(h.maxParallelPersonas),
        naiveUserRuns: String(h.naiveUserRuns),
        maxVerificationAttempts: String(h.maxVerificationAttempts),
      });
    } catch {
      // Best-effort: the card keeps showing the defaults.
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function save(next: HarnessBlock) {
    if (!execution) return;
    setSaving(true);
    try {
      // Re-read right before sending: `execution` is a one-shot snapshot from
      // mount, and the daemon merges `execution` field-by-field against
      // whatever it holds *now* — a stale snapshot here would silently
      // overwrite fields a sibling card (Models) saved in the meantime (W12).
      const freshRes = await apiFetch('/api/daemon');
      const freshExecution = freshRes.ok
        ? (((await freshRes.json()) as { config?: { execution?: Record<string, unknown> } }).config
            ?.execution ?? execution)
        : execution;
      const res = await apiFetch('/api/daemon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution: { ...freshExecution, harness: next } }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success('Harness settings saved');
      await loadConfig();
    } catch {
      toast.error('Failed to save harness settings');
      await loadConfig();
    } finally {
      setSaving(false);
    }
  }

  function commitField(field: NumericField) {
    const bounds = BOUNDS[field];
    const parsed = Number.parseInt(drafts[field], 10);
    if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
      toast.error(`${bounds.label} must be between ${bounds.min} and ${bounds.max}`);
      setDrafts((d) => ({ ...d, [field]: String(harness[field]) }));
      return;
    }
    if (parsed === harness[field]) return;
    void save({ ...harness, [field]: parsed });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Acceptance harness
        </CardTitle>
        <CardDescription className="mt-1.5">
          These directly control how much of your Claude quota autonomous verification consumes —
          every persona spawn and judge pass runs on your subscription window, same as a builder
          task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor="auto-verify" className="flex items-center justify-between gap-2 text-sm">
          <span>
            Auto-verify
            <span className="block text-xs text-muted-foreground">
              Pick up awaiting-verification tasks from the poll cycle automatically.
            </span>
          </span>
          <Switch
            id="auto-verify"
            checked={harness.autoVerify}
            disabled={saving}
            onCheckedChange={(next) => void save({ ...harness, autoVerify: next })}
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {(Object.keys(BOUNDS) as NumericField[]).map((field) => (
            <div key={field} className="space-y-1.5">
              <p className="text-muted-foreground text-xs">{BOUNDS[field].label}</p>
              <Input
                type="number"
                min={BOUNDS[field].min}
                max={BOUNDS[field].max}
                value={drafts[field]}
                disabled={saving}
                onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                onBlur={() => commitField(field)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-8"
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          More parallel personas and naive-user runs make for a thorough pass but burn more sessions
          per verification; a higher attempt cap lets a stubborn task retry longer before it&apos;s
          marked Blocked (D4) instead of giving up sooner.
        </p>
      </CardContent>
    </Card>
  );
}

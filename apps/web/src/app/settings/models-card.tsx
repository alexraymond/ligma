'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { Cpu } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Models settings card — which model each agent role runs on.
 *
 * `execution.workerModel` (builders, discovery, triage, scheduled skills) and
 * `execution.harness.{personaModel,judgeModel}` already round-trip through
 * `PUT /api/daemon` (apps/daemon/src/store/validations.ts already declares all
 * three; apps/daemon/src/routes/daemon/route.ts already merges `execution`
 * field-by-field) — this card is the missing UI, not a new wire format. Wire
 * shape is declared locally rather than imported from `use-daemon.ts`'s
 * `DaemonConfig` for the same reason memory-card.tsx does: that type has no
 * `workerModel`/`harness.personaModel` fields yet (not this feature's file —
 * see the handoff note), and round-tripping the whole `execution` block as a
 * loosely-typed record survives that gap either way.
 *
 * Free-text inputs, not a dropdown: the CLI accepts aliases (sonnet/opus/haiku)
 * or full model ids, and which full ids are valid depends on the user's plan —
 * a hardcoded list would either block valid models or suggest ones the account
 * can't use.
 *
 * Judge-must-differ-from-worker guard lives here (client-side) and nowhere in
 * apps/daemon/src/store/validations.ts. daemonConfigUpdateSchema's `execution`
 * is one Zod object, so a `.refine` there COULD compare `workerModel` against
 * `harness.judgeModel` — but only for a request that includes both. A caller
 * that PATCHes `execution.harness` alone (workerModel absent from the body)
 * would sail through that refine and still collide after
 * apps/daemon/src/routes/daemon/route.ts merges it onto the stored config —
 * the refine never sees the stored side. That's a real gap, not a hypothetical
 * one: this schema is shared by every PUT /api/daemon caller, not just this
 * card. A schema check that's only sometimes true is worse than none, so the
 * check stays here, where both drafts are always in scope before the request
 * is built. apps/daemon/src/harness/judge.ts's `assertJudgeModel` is the
 * runtime backstop that actually can't be bypassed (it runs against the
 * resolved config at verification time, not a request body) — this guard just
 * saves the round trip to discover the same refusal.
 */

interface HarnessBlock {
  autoVerify: boolean;
  maxParallelPersonas: number;
  naiveUserRuns: number;
  maxVerificationAttempts: number;
  judgeModel: string | null;
  personaModel?: string | null;
}

/** Studio's own lanes are pinned by env var, not daemon-config — see below. */
const STUDIO_LANES: { label: string; envVar: string }[] = [
  { label: 'Generation (chat turns)', envVar: 'LIGMA_STUDIO_MODEL' },
  { label: 'Critic (auto-critique)', envVar: 'LIGMA_STUDIO_CRITIC_MODEL' },
  { label: 'Planner (promote-to-build)', envVar: 'LIGMA_STUDIO_PLANNER_MODEL' },
];
const STUDIO_DEFAULT = 'claude-sonnet-4-5';

/** Blank means "the daemon's default" (CLI default model), same convention page.tsx uses. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function ModelsCard() {
  const [execution, setExecution] = useState<Record<string, unknown> | null>(null);
  const [workerDraft, setWorkerDraft] = useState('');
  const [personaDraft, setPersonaDraft] = useState('');
  const [judgeDraft, setJudgeDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon');
      if (!res.ok) return;
      const body = (await res.json()) as { config?: { execution?: Record<string, unknown> } };
      const exec = body.config?.execution ?? null;
      setExecution(exec);
      const harness = exec?.harness as HarnessBlock | undefined;
      setWorkerDraft((exec?.workerModel as string | null | undefined) ?? '');
      setPersonaDraft(harness?.personaModel ?? '');
      setJudgeDraft(harness?.judgeModel ?? '');
    } catch {
      // Best-effort: the card keeps showing blank (= daemon default) fields.
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function save() {
    if (!execution) return;
    const worker = blankToNull(workerDraft);
    const persona = blankToNull(personaDraft);
    const judge = blankToNull(judgeDraft);

    // Same reasoning as harness/judge.ts's assertJudgeModel: a blank worker
    // field means "CLI default", the same sentinel the runtime check treats a
    // null builder model as, so it collides with an equally-named judge model.
    if (judge && judge === (worker ?? 'default')) {
      toast.error(
        `Refusing to save: judge model "${judge}" is the same as the worker model. A model cannot grade its own work.`,
      );
      return;
    }

    setSaving(true);
    try {
      // Re-read right before sending: `execution` is a one-shot snapshot from
      // mount, and the daemon merges `execution` field-by-field against
      // whatever it holds *now* — a stale snapshot here would silently
      // overwrite fields a sibling card (Harness) saved in the meantime (W12).
      const freshRes = await apiFetch('/api/daemon');
      const freshExecution = freshRes.ok
        ? (((await freshRes.json()) as { config?: { execution?: Record<string, unknown> } }).config
            ?.execution ?? execution)
        : execution;
      const existingHarness = (freshExecution.harness ?? {}) as Record<string, unknown>;
      const res = await apiFetch('/api/daemon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution: {
            ...freshExecution,
            workerModel: worker,
            harness: { ...existingHarness, personaModel: persona, judgeModel: judge },
          },
        }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success('Model settings saved');
      await loadConfig();
    } catch {
      toast.error('Failed to save model settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Models
        </CardTitle>
        <CardDescription className="mt-1.5">
          Which model each agent role runs on. Accepts an alias (
          <code className="font-mono text-[11px]">sonnet</code>,{' '}
          <code className="font-mono text-[11px]">opus</code>,{' '}
          <code className="font-mono text-[11px]">haiku</code>) or a full model id — not a dropdown,
          because which full ids are valid depends on your plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">Worker model</p>
            <Input
              value={workerDraft}
              onChange={(e) => setWorkerDraft(e.target.value)}
              placeholder="sonnet"
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Builders, discovery, triage, scheduled skills.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">Persona model</p>
            <Input
              value={personaDraft}
              onChange={(e) => setPersonaDraft(e.target.value)}
              placeholder="sonnet"
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Harness testers (naive-user, saboteur, etc).
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">Judge model</p>
            <Input
              value={judgeDraft}
              onChange={(e) => setJudgeDraft(e.target.value)}
              placeholder="opus"
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Must differ from the worker model — it grades its work.
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          All models share one subscription usage window — a premium model burns it faster, it
          doesn&apos;t cost extra on top. Blank means the daemon&apos;s default (CLI default model).
        </p>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={saving || !execution}>
            {saving ? 'Saving...' : 'Save models'}
          </Button>
        </div>

        <div className="space-y-1.5 border-t pt-4">
          <p className="text-xs font-medium">Studio lanes (read-only)</p>
          <p className="text-[11px] text-muted-foreground">
            Studio&apos;s generation/critic/planner models are pinned by environment variable, not
            this form, and no daemon route exposes their live value today (the routes this card can
            add to don&apos;t carry them either, so this list shows the documented default rather
            than fetching it). Set the env var and restart the daemon to change one.
          </p>
          <ul className="space-y-1 text-xs">
            {STUDIO_LANES.map((lane) => (
              <li key={lane.envVar} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{lane.label}</span>
                <code className="font-mono text-[11px]">
                  {lane.envVar} ?? &ldquo;{STUDIO_DEFAULT}&rdquo;
                </code>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Routing specific task tags to Codex or Gemini instead of picking their model is a
          separate, editable knob —<code className="font-mono text-[11px]"> codexTaskTags</code> /{' '}
          <code className="font-mono text-[11px]">geminiTaskTags</code> in the Configuration card
          above (only take effect when Backend Mode is Mixed).
        </p>
      </CardContent>
    </Card>
  );
}

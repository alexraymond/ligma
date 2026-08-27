'use client';

import { useRotatingPlaceholder } from '@/components/composer-placeholder-carousel';
import { ComposerSubChips } from '@/components/composer-sub-chips';
import { ComposerTemplatePicker } from '@/components/composer-template-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  type ComposerState,
  EMPTY_COMPOSER,
  PROJECT_KINDS,
  composerRequest,
  gateComposer,
  seedPromptFromSubChip,
  starterPromptForKind,
} from '@/lib/composer';
import { showError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { AdoptionRun, BriefResponse } from '@ligma/api';
import { FolderInput, Loader2, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The front door (UX spec F1 step 1) — open-design's hero, ported: one prompt
 * box, optional chips, and a gate that **names the missing field before you
 * press the button** instead of a red toast after.
 *
 * Prompt-first with "Adopt a repo" as a chip is the pinned default (build brief
 * §2). The design-system picker belongs to the Library (Phase 4) and to the
 * Studio's own composer — a disabled chip here would be a promise this surface
 * cannot keep, so it is absent rather than stubbed.
 */
export interface KickoffComposerProps {
  /** Called once a kickoff succeeded and the navigation is away — the modal's cue to close. */
  onStarted?: () => void;
}

export function KickoffComposer({ onStarted }: KickoffComposerProps = {}) {
  const router = useRouter();
  const [state, setState] = useState<ComposerState>(EMPTY_COMPOSER);
  const [busy, setBusy] = useState(false);
  // `POST /api/briefs` creates the project immediately but doesn't respond
  // until discovery finishes running inside the same call (no lighter
  // create-then-poll shape exists server-side) — so the id isn't obtainable
  // any earlier than the whole response. Rebuilding is out of scope; this
  // just stops a spinner from being the only signal for that whole wait.
  const [discovering, setDiscovering] = useState(false);
  const gate = gateComposer(state);
  const adopting = state.mode === 'adopt';
  const promptEmpty = state.prompt.trim() === '';
  // OD-087: a calm, slow rotation through starter examples — only while
  // there's nothing typed yet, so it never competes with real input.
  const rotatingPlaceholder = useRotatingPlaceholder(state.kind, !adopting && promptEmpty);
  const starterPrompt = !adopting ? starterPromptForKind(state.kind) : null;

  async function submit() {
    if (!gate.ok || busy) return;
    setBusy(true);
    const { url, body } = composerRequest(state);
    if (url === '/api/briefs') setDiscovering(true);
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? 'The daemon turned that down');
      }
      setState(EMPTY_COMPOSER);
      if (url === '/api/briefs') {
        // `/api/projects` is served with `max-age=2, stale-while-revalidate=5`,
        // so the project space we are about to open would read its own brand-new
        // project out of a stale cache and render "Project not found". One
        // forced revalidation refreshes the cache entry before we navigate into
        // something that depends on it.
        await apiFetch('/api/projects', { cache: 'reload' }).catch(() => {});
        router.push(`/projects/${(json as BriefResponse).brief.projectId}/brief`);
      } else {
        router.push(`/adoption/${(json as AdoptionRun).id}`);
      }
      onStarted?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setDiscovering(false);
    }
  }

  return (
    <Card role="region" aria-label="Start something new">
      <CardContent className="p-4 space-y-3">
        {!adopting && (
          <div className="space-y-1">
            <label htmlFor="kickoff-name" className="text-sm font-semibold">
              Project name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="kickoff-name"
              disabled={busy}
              value={state.name}
              placeholder="Left blank, one is inferred from the brief"
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            />
          </div>
        )}

        <label htmlFor="kickoff-prompt" className="text-sm font-semibold">
          What are we making?
        </label>

        {adopting ? (
          <Input
            id="kickoff-prompt"
            autoFocus
            disabled={busy}
            value={state.repoPath}
            placeholder="/Users/you/code/the-repo"
            onChange={(e) => setState((s) => ({ ...s, repoPath: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        ) : (
          <Textarea
            id="kickoff-prompt"
            rows={3}
            disabled={busy}
            value={state.prompt}
            placeholder={rotatingPlaceholder}
            onChange={(e) => setState((s) => ({ ...s, prompt: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            active={adopting}
            onClick={() => setState((s) => ({ ...s, mode: adopting ? 'prompt' : 'adopt' }))}
          >
            <FolderInput className="h-3 w-3" /> Adopt a repo
          </Chip>
          {!adopting && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              {PROJECT_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  active={state.kind === kind}
                  onClick={() => setState((s) => ({ ...s, kind: s.kind === kind ? null : kind }))}
                >
                  {kind}
                </Chip>
              ))}
              <span className="ml-auto">
                <ComposerTemplatePicker
                  kind={state.kind}
                  onPick={(kind) =>
                    setState((s) => ({ ...s, kind: s.kind === kind ? null : kind }))
                  }
                />
              </span>
            </>
          )}
        </div>

        {/* Sub-chips + starter line only once a kind narrows the pool — an
            empty composer stays exactly as calm as before (OD-022/087). */}
        {!adopting && state.kind ? (
          <div className="space-y-1">
            <ComposerSubChips
              kind={state.kind}
              onPick={(chip) =>
                setState((s) => ({ ...s, prompt: seedPromptFromSubChip(s.prompt, chip) }))
              }
            />
            {promptEmpty && starterPrompt ? (
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, prompt: starterPrompt }))}
                className="block text-left text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                Try: {starterPrompt}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {/* The gate speaks before the button is pressed, never after. Once
              Start is pressed, discovery runs synchronously behind the same
              request (no lighter shape to poll instead), so this line is the
              only signal until the brief page takes over the wait. */}
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {discovering
              ? 'Project created — discovery is running, this can take a minute.'
              : (gate.missing ??
                (adopting
                  ? 'A run will infer the boot recipe and propose journeys — you confirm them on one sheet.'
                  : 'Discovery will ask a few questions as a form, then lock the brief.'))}
          </p>
          <Button
            onClick={() => void submit()}
            disabled={!gate.ok || busy}
            className="gap-1.5 shrink-0"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {adopting ? 'Adopt' : 'Start'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The same composer, in a modal — "the composer as a modal, right where the
 * result will appear: the rail" (UX-REDESIGN §3 Zone 1). Same component, same
 * gate, same navigation on success; only the frame differs, so the inline
 * front door on Home and the rail's "+" cannot drift into two kickoff flows.
 */
export function KickoffComposerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-4">
        <DialogHeader className="px-1">
          <DialogTitle>Start something new</DialogTitle>
        </DialogHeader>
        <KickoffComposer onStarted={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

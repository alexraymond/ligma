'use client';

/**
 * The Studio surface: composer pane + canvas, with the Wall as the default
 * canvas (UX spec §6, F4).
 *
 * Since spec `2026-08-26-studio-fullscreen-workspace-design` this is a
 * full-viewport workspace rather than a panel inside the app shell — the rail
 * and the project header stand down for `/projects/:id/studio` (`isStudioRoute`
 * in lib/nav) and the slim bar below is the only chrome left. The bar is a
 * re-arrangement of the controls this surface already had, not new machinery.
 *
 * The layout is the merge thesis in one screen — "open-design's front door,
 * ligma-classic's studio, mission-control's engine room". The canvas is
 * ligma-classic's (paper warmth, Wall, pins, tweaks); everything outside the
 * canvas edge is the cockpit's shadcn (UX spec §9). The critique lane sits
 * under the artifact and is visible by default, never behind a setting.
 */

import { parseStudioDeepLink } from '@/app/projects/[id]/studio/deep-link';
import { FailureCard } from '@/components/failure';
import { recordLibraryUse } from '@/components/library/library-meta';
import { OnboardingHint } from '@/components/onboarding';
import { projectHealthKey } from '@/components/project-health-board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { useProjects } from '@/hooks/use-data';
import { projectPipelineKeys } from '@/hooks/use-project-pipeline';
import { showError, showSuccess } from '@/lib/toast';
import { useInvalidate } from '@/providers/collections-provider';
import type { DesignPin, DesignSummary, TweakValues } from '@ligma/api';
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
  Eye,
  Images,
  Layers,
  Maximize,
  Maximize2,
  MessageSquarePlus,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Rocket,
  Send,
  Smartphone,
  Square,
  Tablet,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  type FileChange,
  approveDesign,
  createDesign,
  createPin,
  exportDesign,
  interruptTurn,
  listDesigns,
  previewPinInstruction,
  readDesignFiles,
  restoreSnapshot,
  sendTurn,
  updateDesign,
  updatePin,
  uploadAttachment,
  versionDiff,
} from './api';
import { CanvasViewport, ZOOM_LEVELS, clampZoom, fitZoom } from './canvas-viewport';
import { CodeView } from './code-view';
import {
  AttachButton,
  AttachmentStrip,
  type PendingAttachment,
  SkillMentionList,
  insertMention,
  mentionQuery,
  readAttachments,
} from './composer';
import { CritiqueLane } from './critique-lane';
import { DesignGallery } from './design-gallery';
import { DesignSystemPicker } from './design-system-picker';
import { DirectionCards, StarterPrompts } from './direction-cards';
import { studioEscapeStep } from './escape-chain';
import { ExportDiagnosticsPanel } from './export-diagnostics-panel';
import { exportErrorCode } from './export-error-code';
import { type ExportAttempt, readExportHistory, recordExportAttempt } from './export-history';
import { type DeviceViewport, FocusPreview, type PinTarget } from './focus-preview';
import { StudioPaperTokens } from './paper';
import { PinChips } from './pin-chips';
import { PromoteSheet } from './promote-sheet';
import { TranscriptPane } from './transcript-pane';
import { TweaksPanel } from './tweaks-panel';
import { useDesign } from './use-design';
import { VersionRail } from './version-rail';
import { Wall } from './wall';

const VIEWPORTS: { key: DeviceViewport; label: string; Icon: typeof Monitor }[] = [
  { key: 'desktop', label: 'Desktop', Icon: Monitor },
  { key: 'tablet', label: 'Tablet', Icon: Tablet },
  { key: 'mobile', label: 'Mobile', Icon: Smartphone },
];

const CHANGE_TONE: Record<FileChange['change'], string> = {
  added: 'text-green-600',
  removed: 'text-destructive',
  changed: 'text-amber-600',
  unchanged: 'text-muted-foreground',
};

/**
 * Side-by-side before/after for two versions (F4).
 *
 * Fingerprints make this exact: two versions listing the same SHA-256 for a
 * path provably contain the same bytes, so "unchanged" is a fact rather than a
 * guess. Rendering the two *historical* previews side by side additionally
 * needs a version-scoped source route, which the design API does not have yet —
 * so this shows what did change and the live preview shows the current state,
 * rather than showing two identical thumbnails and implying nothing moved.
 */
function CompareDiff({
  before,
  after,
}: {
  before: { path: string; fingerprint: string }[];
  after: { path: string; fingerprint: string }[];
}) {
  const changes = versionDiff(before, after);
  const moved = changes.filter((c) => c.change !== 'unchanged');
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">
        {moved.length === 0
          ? 'identical content'
          : `${moved.length} file${moved.length === 1 ? '' : 's'} changed`}
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto">
        {changes.map((change) => (
          <li
            key={change.path}
            className={`flex items-baseline gap-1.5 font-mono text-[10px] ${CHANGE_TONE[change.change]}`}
          >
            <span className="w-2 shrink-0">
              {change.change === 'added'
                ? '+'
                : change.change === 'removed'
                  ? '−'
                  : change.change === 'changed'
                    ? '~'
                    : '·'}
            </span>
            <span className="truncate" title={change.path}>
              {change.path}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StudioSurface({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const deepLink = parseStudioDeepLink(searchParams);
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [designId, setDesignId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [designSystem, setDesignSystem] = useState<string | null>(null);
  /** Reference images the composer is holding — uploaded when the turn is sent. */
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  // Only needed for the very first turn: `busy` (below) is `live.turnInFlight`,
  // which is scoped to an existing design and stays false while `createDesign`
  // is in flight for a brand-new session — a double-click on Send before it
  // resolves fired `submitPrompt` twice and created two designs (W9).
  const [creatingDesign, setCreatingDesign] = useState(false);
  /** Caret position, so the `@` type-ahead knows which token it is inside. */
  const [caret, setCaret] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<'wall' | 'focus'>('wall');
  /** What Focus shows: the rendered screen, or the file the designer wrote. */
  const [focusView, setFocusView] = useState<'preview' | 'source'>('preview');
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [viewport, setViewport] = useState<DeviceViewport>('desktop');
  const [zoom, setZoom] = useState(100);
  const [commentMode, setCommentMode] = useState(false);
  const [pinDraft, setPinDraft] = useState<(PinTarget & { text: string }) | null>(null);
  const [critiqueOpen, setCritiqueOpen] = useState(true);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [promoteOpen, setPromoteOpen] = useState(false);
  // Tweaks open by default (§16): this surface only ever mounts for a
  // design-shaped project — `studio/page.tsx` 404s unless `studioVisible(shape)`
  // — so the shape check is the route's, and the knobs are what a design-shaped
  // project reaches for first. Versions stay one click away.
  const [tab, setTab] = useState<'tweaks' | 'versions'>('tweaks');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportAttempt[]>(() => readExportHistory());
  // Workspace panes. The composer's collapse is remembered per project (one
  // key per project, `export-history.ts`'s localStorage idiom); the version /
  // tweaks rail is not — it is a glance, not a working posture.
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  const router = useRouter();
  const pathname = usePathname();
  const { projects } = useProjects();
  const projectName = projects.find((p) => p.id === projectId)?.name ?? 'Studio';
  const buildHref = `/projects/${encodeURIComponent(projectId)}/board`;
  const composerKey = `ligma:studio:composer-collapsed:${projectId}`;
  // Zoom is remembered per *design*, not per project: 200% on a mobile screen
  // and 50% on a dense dashboard are different working postures, and switching
  // designs should land you back where you left that one.
  const zoomKey = designId ? `ligma:studio:zoom:${designId}` : null;
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Read in an effect, not in `useState`'s initialiser: the server render has no
  // localStorage, and a value only the client can know must not decide the first
  // HTML (hydration mismatch).
  useEffect(() => {
    try {
      setComposerCollapsed(window.localStorage.getItem(composerKey) === '1');
    } catch {
      // Private mode — the pane simply opens every time, which is not a failure.
    }
  }, [composerKey]);

  const toggleComposer = useCallback(() => {
    setComposerCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(composerKey, next ? '1' : '0');
      } catch {
        // Same as above: forgetting is survivable, interrupting the click is not.
      }
      return next;
    });
  }, [composerKey]);

  // Same read-in-an-effect rule as the composer collapse above: localStorage
  // must not decide the first HTML. A design with nothing remembered opens at
  // 100%, which is also what a wheel-zoom on the previous design must not leak
  // into.
  useEffect(() => {
    if (!zoomKey) return;
    try {
      const saved = Number(window.localStorage.getItem(zoomKey));
      setZoom(saved > 0 ? clampZoom(saved) : 100);
    } catch {
      setZoom(100);
    }
  }, [zoomKey]);

  /** Every zoom change goes through here, so every one of them is remembered. */
  const changeZoom = useCallback(
    (next: number) => {
      const z = clampZoom(next);
      setZoom(z);
      if (!zoomKey) return;
      try {
        window.localStorage.setItem(zoomKey, String(z));
      } catch {
        // Private mode — the zoom simply starts at 100% next time.
      }
    },
    [zoomKey],
  );

  /**
   * Open one of this route's drawers (`StagePanelHost` on `studio/page.tsx`)
   * by setting `?panel=` — the same param the host closes by clearing, and the
   * rest of the query (the deep link) is left alone.
   */
  const openPanel = useCallback(
    (panel: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('panel', panel);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [searchParams, router, pathname],
  );

  /** Zoom until the whole canvas is on screen, measured from the live scroll box. */
  const fitToView = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    changeZoom(
      fitZoom(
        { width: el.scrollWidth, height: el.scrollHeight },
        { width: el.clientWidth, height: el.clientHeight },
        zoom,
      ),
    );
  }, [changeZoom, zoom]);

  const invalidate = useInvalidate();
  const live = useDesign(projectId, designId);
  const design = live.state?.design ?? null;
  const snapshots = live.state?.snapshots ?? [];
  const pins = design?.pins ?? [];

  const refreshDesigns = useCallback(async () => {
    try {
      const next = await listDesigns(projectId);
      setDesigns(next);
      setDesignId(
        (current) =>
          current ??
          (deepLink.designId && next.some((d) => d.id === deepLink.designId)
            ? deepLink.designId
            : (next[0]?.id ?? null)),
      );
    } catch (err) {
      // One error model (UX spec §7): name the surface that failed, never a
      // bare status line.
      showError(
        `Could not load this project's designs — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [projectId]);

  useEffect(() => {
    void refreshDesigns();
  }, [refreshDesigns]);

  // Card order is client-side: the manifest lists files, it does not rank them.
  const paths = useMemo(() => {
    const latest = design?.versions.at(-1)?.files.map((f) => f.path) ?? [];
    if (!order) return latest;
    const known = new Set(latest);
    return [...order.filter((p) => known.has(p)), ...latest.filter((p) => !order.includes(p))];
  }, [design, order]);

  useEffect(() => {
    if (deepLink.filePath && paths.includes(deepLink.filePath) && focusedPath === null) {
      setFocusedPath(deepLink.filePath);
      setMode('focus');
      return;
    }
    if (focusedPath === null && paths.length > 0) setFocusedPath(paths[0]);
  }, [paths, focusedPath, deepLink.filePath]);

  // No design, no turn: the live hook keeps the last design's `turnInFlight`
  // when it unsubscribes, which used to leave a "Stop" button sitting on an
  // empty new-design composer that has nothing to stop.
  const busy = designId !== null && live.turnInFlight;

  /** Switch designs — or, with `null`, open a fresh one. Both reset what the old design owned. */
  const switchDesign = (id: string | null): void => {
    setDesignId(id);
    setOrder(null);
    setFocusedPath(null);
    setSelectedPaths([]);
  };

  /**
   * Whether the composer is at a design's start — no design chosen, or one that
   * has produced no version and is not producing one right now. That is when
   * the direction cards and starter prompts earn their space; mid-turn the
   * transcript wants the column instead.
   */
  const firstDesign = !designId || (design !== null && design.versions.length === 0 && !busy);

  /**
   * Auto-open the newest artifact. A turn that writes three screens used to
   * leave the focus on whatever `paths[0]` happened to be; the file the
   * designer is writing right now is the one worth looking at.
   *
   * The follow yields to the user: picking a card or a transcript file mid-turn
   * (`chooseFocus`) pins the choice for the rest of that turn, and the next
   * turn starts following again.
   */
  const userChoseFocus = useRef(false);

  const chooseFocus = useCallback((path: string) => {
    userChoseFocus.current = true;
    setFocusedPath(path);
    setMode('focus');
  }, []);

  useEffect(() => {
    if (busy) userChoseFocus.current = false;
  }, [busy]);

  useEffect(() => {
    if (live.writingPath && !userChoseFocus.current) setFocusedPath(live.writingPath);
  }, [live.writingPath]);

  // ESC walks outward, one layer per press (`escape-chain.ts`), and only when
  // nothing inner has already claimed the key: the Promote sheet and the export
  // menu are Radix layers that dismiss themselves, and a caret in a text field
  // owns its own ESC — exiting the workspace out from under a half-typed prompt
  // would throw the prompt away. The pin draft is checked first regardless,
  // because its textarea *is* the layer ESC should close.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const step = studioEscapeStep({ pinDraft: pinDraft !== null, commentMode, mode });
      if (step === 'close-pin-draft') {
        setPinDraft(null);
        return;
      }
      if (promoteOpen) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (step === 'disarm-pin') setCommentMode(false);
      else if (step === 'leave-focus') setMode('wall');
      else router.push(buildHref);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pinDraft, commentMode, mode, promoteOpen, router, buildHref]);

  /**
   * Send one prompt turn. Takes the text rather than reading `prompt` so the
   * transcript's Retry button re-sends a failed turn through this exact path —
   * a retry that took a different route would be a second turn implementation.
   */
  const submitPrompt = async (text: string): Promise<void> => {
    if (text === '' || creatingDesign) return;
    const pending = attachments;
    try {
      if (!designId) {
        setCreatingDesign(true);
        // The images ride along with the create: there is no design id to
        // upload them against until this call returns one.
        const created = await createDesign(projectId, {
          prompt: text,
          ...(designSystem ? { designSystem } : {}),
          ...(pending.length > 0
            ? { attachments: pending.map(({ name, dataUrl }) => ({ name, dataUrl })) }
            : {}),
        });
        setDesignId(created.design.id);
        // Library use tracking: fire-and-forget — a lost count is not an error.
        if (designSystem) void recordLibraryUse('design-system', designSystem).catch(() => {});
        await refreshDesigns();
      } else {
        // Bytes first, then the turn that names them: an upload that fails
        // must not produce a turn that silently ignored the reference.
        const attachmentIds: string[] = [];
        for (const item of pending) {
          const stored = await uploadAttachment(projectId, designId, {
            name: item.name,
            dataUrl: item.dataUrl,
          });
          if (!attachmentIds.includes(stored.id)) attachmentIds.push(stored.id);
        }
        await sendTurn(projectId, designId, {
          kind: 'prompt',
          prompt: text,
          // Multi-select scopes the next prompt to the chosen cards (F4).
          ...(selectedPaths.length > 0 ? { filePaths: selectedPaths } : {}),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        });
      }
      setPrompt('');
      setAttachments([]);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'The turn was refused');
    } finally {
      setCreatingDesign(false);
    }
  };

  /** Add pasted / dropped / chosen images to what the next turn will carry. */
  const addAttachments = (files: File[]): void => {
    void readAttachments(files, showError).then((next) => {
      if (next.length > 0) setAttachments((current) => [...current, ...next]);
    });
  };

  /**
   * Choose the design system. Before a design exists this is local state the
   * create call will carry; afterwards it is a manifest change that takes
   * effect on the next turn — nothing already on the canvas is redrawn.
   */
  const chooseDesignSystem = async (id: string | null): Promise<void> => {
    setDesignSystem(id);
    if (id) void recordLibraryUse('design-system', id).catch(() => {});
    if (!designId) return;
    try {
      await updateDesign(projectId, designId, { designSystem: id });
      await live.refresh();
      showSuccess(
        id ? `Next turn draws against ${id}` : 'Next turn draws against no design system',
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not change the design system');
    }
  };

  const applyPins = async (): Promise<void> => {
    if (!designId) return;
    try {
      await sendTurn(projectId, designId, { kind: 'comment-apply', prompt: prompt.trim() });
      setPrompt('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not apply the pins');
    }
  };

  const applyTweaks = async (values: TweakValues): Promise<void> => {
    if (!designId) return;
    try {
      const accepted = await sendTurn(projectId, designId, { kind: 'tweak', values });
      if (accepted.appliedWithoutSpawn) showSuccess('Applied live — no generation needed');
      await live.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not apply the tweaks');
    }
  };

  const savePinDraft = async (): Promise<void> => {
    if (!designId || !pinDraft || pinDraft.text.trim() === '') return;
    try {
      await createPin(projectId, designId, {
        filePath: pinDraft.filePath,
        selector: pinDraft.selector,
        tag: pinDraft.tag,
        outerHTML: pinDraft.outerHTML,
        parentOuterHTML: pinDraft.parentOuterHTML,
        text: pinDraft.text.trim(),
      });
      setPinDraft(null);
      await live.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not pin that');
    }
  };

  const removePin = async (pin: DesignPin): Promise<void> => {
    if (!designId) return;
    await updatePin(projectId, designId, { pinId: pin.id, remove: true }).catch(() => undefined);
    await live.refresh();
  };

  const approve = async (): Promise<void> => {
    if (!designId) return;
    try {
      await approveDesign(projectId, designId);
      showSuccess('Design approved — the oracle is frozen');
      await live.refresh();
      await refreshDesigns();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not approve');
    }
  };

  const restore = async (versionId: string): Promise<void> => {
    if (!designId) return;
    try {
      await restoreSnapshot(projectId, designId, versionId);
      await live.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not restore');
    }
  };

  /**
   * Export the design as a file (D7 DC-1). Available at any status, not only
   * approved: a design you are still iterating on is exactly the one you want
   * to hand to somebody, and the parent gated on nothing.
   */
  const runExport = async (format: ExportFormat): Promise<void> => {
    if (!designId) return;
    setExporting(format);
    try {
      const { filename, blob } = await exportDesign(projectId, designId, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      // Deferred, not immediate (W22): `click()` only *starts* the browser's
      // download of the blob URL — revoking it in the same tick raced that
      // read and could cancel the download before it began.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      showSuccess(`Exported ${filename}`);
      setExportHistory(
        recordExportAttempt({ format, ok: true, code: 'OK', message: `Exported ${filename}` }),
      );
    } catch (err) {
      const code = exportErrorCode(err);
      showError(err instanceof Error ? err.message : 'Could not export');
      setExportHistory(
        recordExportAttempt({
          format,
          ok: false,
          code,
          message: err instanceof Error ? err.message : 'Could not export',
        }),
      );
    } finally {
      setExporting(null);
    }
  };

  /**
   * The screen on the clipboard, ready to paste into a deck or a chat — the
   * shortest path from "this looks right" to showing somebody.
   *
   * PNG only: it is the one image type every clipboard implementation accepts.
   * A browser without the async clipboard image API (Firefox at the time of
   * writing) says so and points at the download, rather than failing silently.
   */
  const copyPngToClipboard = async (): Promise<void> => {
    if (!designId) return;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      showError("This browser can't put images on the clipboard — use Export → PNG image instead.");
      return;
    }
    setExporting('png');
    try {
      const { blob } = await exportDesign(projectId, designId, 'png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showSuccess('PNG copied — paste it anywhere');
      setExportHistory(
        recordExportAttempt({
          format: 'png',
          ok: true,
          code: 'OK',
          message: 'Copied a PNG to the clipboard',
        }),
      );
    } catch (err) {
      const code = exportErrorCode(err);
      showError(err instanceof Error ? err.message : 'Could not copy the PNG');
      setExportHistory(
        recordExportAttempt({
          format: 'png',
          ok: false,
          code,
          message: err instanceof Error ? err.message : 'Could not copy the PNG',
        }),
      );
    } finally {
      setExporting(null);
    }
  };

  const approved = design?.status === 'approved';
  /** The `@`-mention the caret is inside, if any — drives the type-ahead. */
  const mention = mentionQuery(prompt, caret);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <StudioPaperTokens />

      {/* ── Slim bar — the workspace's only chrome (~40px) ── */}
      <header className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        <Tip content="Back to Build — Esc">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Back to Build"
            onClick={() => router.push(buildHref)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        </Tip>
        <span className="max-w-[12rem] shrink-0 truncate text-sm font-medium" title={projectName}>
          {projectName}
        </span>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

        <Button
          variant={mode === 'wall' ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
          onClick={() => setMode('wall')}
        >
          <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Wall
        </Button>
        <Button
          variant={mode === 'focus' ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
          onClick={() => setMode('focus')}
          disabled={focusedPath === null}
        >
          <Maximize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Focus
        </Button>

        {mode === 'focus' ? (
          <div className="flex shrink-0 items-center gap-1">
            {/* Preview ⇄ Source. The source is the file the designer wrote —
                read-only, because this canvas is shaped by asking, not typing. */}
            <Button
              variant={focusView === 'preview' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={focusView === 'preview'}
              onClick={() => setFocusView('preview')}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Preview
            </Button>
            <Button
              variant={focusView === 'source' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={focusView === 'source'}
              onClick={() => setFocusView('source')}
            >
              <Code2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Source
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
            {VIEWPORTS.map(({ key, label, Icon }) => (
              <Tip key={key} content={label}>
                <Button
                  variant={viewport === key ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-7 w-7"
                  aria-label={label}
                  onClick={() => setViewport(key)}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </Tip>
            ))}
            <Button
              variant={commentMode ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={commentMode}
              onClick={() => setCommentMode((v) => !v)}
            >
              <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Pin
            </Button>
          </div>
        ) : null}

        {/* Zoom: the readout is the menu (fit + the usual levels), ± either side.
            Every path goes through `changeZoom`, which is what remembers it. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 px-2 font-mono text-[11px] tabular-nums text-muted-foreground"
              aria-label="Zoom level"
            >
              {zoom}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={fitToView}>
              <Maximize className="mr-2 h-3.5 w-3.5" aria-hidden />
              Fit to view
            </DropdownMenuItem>
            {ZOOM_LEVELS.map((level) => (
              <DropdownMenuItem key={level} onSelect={() => changeZoom(level)}>
                {level}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip content="Zoom out">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Zoom out"
            onClick={() => changeZoom(zoom - 10)}
          >
            −
          </Button>
        </Tip>
        <Tip content="Zoom in">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Zoom in"
            onClick={() => changeZoom(zoom + 10)}
          >
            +
          </Button>
        </Tip>
        <Tip content="References & moodboard">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="References"
            onClick={() => openPanel('references')}
          >
            <Images className="h-4 w-4" aria-hidden />
          </Button>
        </Tip>

        <Tip content={railOpen ? 'Hide versions & tweaks' : 'Show versions & tweaks'}>
          <Button
            variant={railOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Versions and tweaks"
            aria-pressed={railOpen}
            onClick={() => setRailOpen((open) => !open)}
          >
            <PanelRight className="h-4 w-4" aria-hidden />
          </Button>
        </Tip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!designId || snapshots.length === 0 || exporting !== null}
              title={
                snapshots.length === 0
                  ? 'Nothing to export until the first version lands'
                  : undefined
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* "Share design" is the Studio's half of the split export (§16):
                the client-facing copy, pre-build. Proof's developer handoff
                keeps its own name, and so does Promote to build. */}
            <DropdownMenuLabel>Share design</DropdownMenuLabel>
            {EXPORT_FORMATS.map(({ format, label }) => (
              <DropdownMenuItem key={format} onSelect={() => void runExport(format)}>
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => void copyPngToClipboard()}>
              <Clipboard className="mr-2 h-3.5 w-3.5" aria-hidden />
              Copy PNG to clipboard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ExportDiagnosticsPanel history={exportHistory} />

        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!designId || approved || busy}
          onClick={() => void approve()}
        >
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {approved ? 'Approved' : 'Approve'}
        </Button>
        <Button
          size="sm"
          className="shrink-0"
          disabled={!approved}
          onClick={() => setPromoteOpen(true)}
          title={approved ? undefined : 'Approve the design first — the oracle must be frozen'}
        >
          <Rocket className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Promote to build
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Composer pane — collapsible, and the collapse is remembered per project ── */}
        {composerCollapsed ? (
          <div className="flex w-10 shrink-0 justify-center border-r pt-2">
            <Tip content="Show composer">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Show composer"
                onClick={toggleComposer}
              >
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              </Button>
            </Tip>
          </div>
        ) : (
          <div className="flex w-80 shrink-0 flex-col border-r">
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <DesignGallery
                designs={designs}
                designId={designId}
                onSelect={(id) => switchDesign(id)}
                onNew={() => switchDesign(null)}
              />
              <Tip content="Hide composer">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Hide composer"
                  onClick={toggleComposer}
                >
                  <PanelLeftClose className="h-4 w-4" aria-hidden />
                </Button>
              </Tip>
            </header>

            <div
              className={`overflow-y-auto p-3 text-xs ${firstDesign ? 'min-h-0 flex-1' : 'max-h-40 shrink-0'}`}
            >
              <OnboardingHint
                id="first-design"
                active={design !== null}
                title="Pins and Critique"
                body="Click any element on the canvas to pin a comment. The Critique lane below scores every generation against the design system automatically — it's always on, never a settings toggle."
                className="mb-2"
              />
              {design ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {design.status}
                    </Badge>
                    {design.designSystem ? (
                      <span className="text-muted-foreground">{design.designSystem}</span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{design.sourcePrompt}</p>
                  {/* `live.error` is only ever set when the turn's stopReason was
                  "error" (use-design.ts) — already classified as a harness
                  malfunction there, never a product verdict on the design. */}
                  {live.error ? (
                    <FailureCard failureClass="harness" detail={live.error} variant="inline" />
                  ) : null}
                </div>
              ) : (
                <p className="mb-3 text-muted-foreground">
                  Describe the screens you want — the designer writes real files and they land on
                  the Wall as it goes.
                </p>
              )}
              {/* The first-design flow (roadmap phase 6): a direction is optional,
              and picking one only edits the prompt you can see below. */}
              {firstDesign ? <DirectionCards prompt={prompt} onChange={setPrompt} /> : null}
            </div>

            {/* The conversation fills the column between the design's header and
            the composer: newest at the bottom, right above where you type.
            Before the first turn there is no conversation — an empty pane would
            hold the column open against the direction cards for nothing. */}
            {live.transcript.length > 0 || busy ? (
              <TranscriptPane
                entries={live.transcript}
                busy={busy}
                onOpenFile={chooseFocus}
                onRetry={(text) => void submitPrompt(text)}
              />
            ) : null}

            <div className="space-y-2 border-t p-3">
              {selectedPaths.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Next prompt is scoped to {selectedPaths.length} selected card
                  {selectedPaths.length === 1 ? '' : 's'} ·{' '}
                  <button type="button" className="underline" onClick={() => setSelectedPaths([])}>
                    clear
                  </button>
                </p>
              ) : null}

              {designId ? (
                <PinChips
                  pins={pins}
                  snapshots={snapshots}
                  disabled={busy}
                  onEditPin={(pin) => setPrompt((p) => (p ? p : pin.text))}
                  onRemovePin={(pin) => void removePin(pin)}
                  onRequestPreview={() =>
                    previewPinInstruction(projectId, designId, { prompt: prompt.trim() })
                  }
                  onApply={() => void applyPins()}
                />
              ) : null}

              {firstDesign ? <StarterPrompts prompt={prompt} onChange={setPrompt} /> : null}

              <AttachmentStrip
                items={attachments}
                onRemove={(index) =>
                  setAttachments((current) => current.filter((_, n) => n !== index))
                }
              />

              {/* The `@` type-ahead sits above the box, so it never covers the
              words being typed and never takes the caret. */}
              {mention ? (
                <SkillMentionList
                  query={mention.query}
                  onPick={(id) => {
                    const next = insertMention(prompt, mention.start, caret, id);
                    setPrompt(next.text);
                    setCaret(next.caret);
                    // React re-renders with the new value first; move the caret
                    // after that, or the browser puts it back at the end.
                    requestAnimationFrame(() => {
                      promptRef.current?.focus();
                      promptRef.current?.setSelectionRange(next.caret, next.caret);
                    });
                  }}
                />
              ) : null}

              <Textarea
                ref={promptRef}
                aria-label="Prompt"
                rows={3}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                // Paste and drop are the two ways a reference image actually
                // arrives — "here, look at this" is a screenshot on the clipboard.
                onPaste={(e) => {
                  const files = [...e.clipboardData.files];
                  if (files.length > 0) addAttachments(files);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const files = [...e.dataTransfer.files];
                  if (files.length === 0) return;
                  e.preventDefault();
                  addAttachments(files);
                }}
                placeholder={
                  designId
                    ? 'Ask for a change…  @ to bring in a skill'
                    : 'Describe the screens you want…'
                }
                className="text-xs"
              />

              <div className="flex items-center gap-1.5">
                <AttachButton onFiles={addAttachments} disabled={busy || creatingDesign} />
                {/* The chip is the current design system, and clicking it swaps it.
                Before Phase 3 this only rendered at session start, which meant a
                design drawn against the wrong system had to be started over. */}
                <DesignSystemPicker
                  value={designId ? (design?.designSystem ?? null) : designSystem}
                  onChange={(id) => void chooseDesignSystem(id)}
                />
                {busy ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => designId && void interruptTurn(projectId, designId)}
                  >
                    <Square className="mr-1.5 h-3 w-3" aria-hidden />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={prompt.trim() === '' || creatingDesign}
                    onClick={() => void submitPrompt(prompt.trim())}
                  >
                    <Send className="mr-1.5 h-3 w-3" aria-hidden />
                    {creatingDesign ? 'Sending…' : 'Send'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Canvas + critique lane ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The canvas names its own mode (§16 honest copy debts). Both claims
            below are true of this component: nothing inside a rendered screen
            is draggable or editable (the only drag on the canvas is Wall card
            reordering, `onReorder` above), and what renders is the design's own
            files (`live.bodies`), never the built product. */}
          <div className="flex items-baseline gap-2 border-b px-3 py-1 text-[11px] leading-snug text-muted-foreground">
            <p>Review canvas — you shape it by asking, not by dragging.</p>
            <details>
              <summary className="cursor-pointer underline underline-offset-2">
                Two things this does not do
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  <span className="font-medium">Direct manipulation.</span> Elements inside a screen
                  cannot be dragged, resized or typed into — ask for the change in words, or drop a
                  pin on the element. (Wall cards drag, but only to rearrange the wall.)
                </li>
                <li>
                  <span className="font-medium">A live product preview.</span> This renders the
                  design files the designer wrote. Whether the built product does the same thing is
                  proven in Proof.
                </li>
              </ul>
            </details>
          </div>

          <div className="flex min-h-0 flex-1">
            <CanvasViewport zoom={zoom} onZoomChange={changeZoom} scrollRef={canvasRef}>
              {mode === 'wall' || focusedPath === null ? (
                <Wall
                  paths={paths}
                  bodies={live.bodies}
                  pins={pins}
                  selectedPaths={selectedPaths}
                  focusedPath={focusedPath}
                  writingPath={live.writingPath}
                  connection={live.connection}
                  onReconnect={live.reconnect}
                  onOpen={chooseFocus}
                  onToggleSelect={(path) =>
                    setSelectedPaths((prev) =>
                      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
                    )
                  }
                  onReorder={setOrder}
                />
              ) : focusView === 'source' ? (
                <div className="h-full p-3">
                  <p className="mb-2 font-mono text-[10px] text-muted-foreground">
                    {focusedPath} · read-only
                  </p>
                  <CodeView
                    path={focusedPath}
                    body={live.bodies[focusedPath] ?? ''}
                    className="h-[calc(100%-1.5rem)]"
                  />
                </div>
              ) : (
                <FocusPreview
                  path={focusedPath}
                  bodies={live.bodies}
                  pins={pins}
                  viewport={viewport}
                  zoom={zoom}
                  commentMode={commentMode}
                  onPinTarget={(target) => setPinDraft({ ...target, text: '' })}
                  onPinClick={(pin) => setPrompt((p) => (p ? p : pin.text))}
                />
              )}
            </CanvasViewport>

            {railOpen ? (
              <div className="flex w-60 shrink-0 flex-col border-l">
                <div className="flex border-b">
                  <button
                    type="button"
                    onClick={() => setTab('versions')}
                    className={`flex-1 px-2 py-1.5 text-xs ${tab === 'versions' ? 'font-medium' : 'text-muted-foreground'}`}
                  >
                    Versions
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('tweaks')}
                    className={`flex-1 px-2 py-1.5 text-xs ${tab === 'tweaks' ? 'font-medium' : 'text-muted-foreground'}`}
                  >
                    Tweaks
                  </button>
                </div>
                {tab === 'versions' ? (
                  <VersionRail
                    snapshots={snapshots}
                    compareSelection={compareSelection}
                    onCompareSelectionChange={setCompareSelection}
                    onRestore={(versionId) => void restore(versionId)}
                    onLoadFiles={
                      designId
                        ? (versionId) => readDesignFiles(projectId, designId, versionId)
                        : undefined
                    }
                    disabled={busy}
                    renderCompare={(before, after) => (
                      <CompareDiff
                        before={
                          design?.versions.find((v) => v.id === before.versionId)?.files ?? []
                        }
                        after={design?.versions.find((v) => v.id === after.versionId)?.files ?? []}
                      />
                    )}
                  />
                ) : (
                  <TweaksPanel
                    schema={design?.tweaks ?? null}
                    values={design?.tweakValues ?? {}}
                    disabled={busy || !designId}
                    onApply={(values) => void applyTweaks(values)}
                  />
                )}
              </div>
            ) : null}
          </div>

          {/* Collapsible bottom strip: the lane keeps its own open/closed state,
            it just has more canvas above it now. */}
          <CritiqueLane
            projectId={projectId}
            designId={designId ?? undefined}
            critique={live.critique}
            currentRule={live.criticRule}
            open={critiqueOpen}
            onOpenChange={setCritiqueOpen}
            onInterrupt={() => designId && void interruptTurn(projectId, designId)}
          />
        </div>
      </div>

      {/* Pin bubble — the comment the click-to-pin gesture is about to carry. */}
      {pinDraft ? (
        <div className="fixed bottom-6 right-6 z-50 w-72 rounded-lg border bg-background p-3 shadow-lg">
          <p className="mb-1 font-mono text-[10px] text-muted-foreground">
            {pinDraft.tag} · {pinDraft.selector}
          </p>
          <Textarea
            autoFocus
            aria-label="Pin comment"
            rows={3}
            value={pinDraft.text}
            onChange={(e) => setPinDraft({ ...pinDraft, text: e.target.value })}
            className="text-xs"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setPinDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pinDraft.text.trim() === ''}
              onClick={() => void savePinDraft()}
            >
              Pin it
            </Button>
          </div>
        </div>
      ) : null}

      {designId ? (
        <PromoteSheet
          projectId={projectId}
          source={{ designId }}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          onPromoted={(result) => {
            showSuccess(`${result.tasks.length} task(s) landed on the Board`);
            // Promote is what freezes the criteria and lands the tasks, so it
            // names everything it changed (F6): the pipeline strip's chips, the
            // Board, the Deck queue, and the Health board used to stay frozen
            // until a reload ("No criteria frozen yet" after a promote that just froze some).
            void invalidate(
              ...projectPipelineKeys(projectId),
              '/api/tasks',
              '/api/deck',
              projectHealthKey(projectId),
            );
          }}
        />
      ) : null}
    </div>
  );
}

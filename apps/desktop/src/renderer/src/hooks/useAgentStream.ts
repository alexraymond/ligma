/**
 * Listens for agent:event:v1 IPC events and fans them into the store.
 *
 * Text deltas are buffered into `streamingAssistantText` so the sidebar
 * chat renders an ephemeral bubble that grows as the model streams.
 * On turn_end the bubble is cleared — `appendChatMessage` persists the
 * final assistant_text row which then replaces the transient view.
 *
 * Tool events are persisted as tool_call chat rows at start time with
 * status='running'; tool_call_result then patches the row to 'done' / 'error'
 * via `chat:update-tool-status:v1`. turn_end is a defensive backstop that
 * marks any still-pending row as 'done' so the WorkingCard never sticks.
 */

import { useEffect, useRef } from 'react';
import type { AgentStreamEvent } from '../../../preload/index';
import { useCodesignStore } from '../store';

interface PendingPersist {
  /** Resolves to the persisted row's seq, or null if the append failed. */
  seqPromise: Promise<number | null>;
  toolName: string;
  toolCallId: string | undefined;
  resolved: boolean;
}

interface InFlightTurn {
  designId: string;
  /** Matches the generationId from agent:event:v1 — guaranteed non-empty since
   *  AgentStreamEvent.generationId is required as of schema v1. */
  generationId: string;
  textBuffer: string;
  /** Final assistant text persisted on the previous turn_end of this run.
   *  pi-agent-core can re-emit the same trailing assistant prose across
   *  consecutive turns (e.g. tool turn → wrap-up turn that repeats the
   *  summary); we keep one copy. */
  lastPersistedText: string | null;
  /** Tool calls persisted as 'running' but whose result event hasn't
   *  arrived yet. Drained at tool_call_result and any leftovers are flipped
   *  to 'done' at turn_end. */
  pendingTools: PendingPersist[];
}

export function useAgentStream(): void {
  const appendChatMessage = useCodesignStore((s) => s.appendChatMessage);
  const setStreamingAssistantText = useCodesignStore((s) => s.setStreamingAssistantText);
  const setPreviewHtmlFromAgent = useCodesignStore((s) => s.setPreviewHtmlFromAgent);
  const recordAgentFileUpdate = useCodesignStore((s) => s.recordAgentFileUpdate);
  const updateChatToolStatus = useCodesignStore((s) => s.updateChatToolStatus);
  const persistAgentRunSnapshot = useCodesignStore((s) => s.persistAgentRunSnapshot);
  const inFlight = useRef<InFlightTurn | null>(null);

  // Throttled live-preview push. iframe srcdoc reloads the whole page on every
  // change, so a flurry of str_replace events (10+ per turn is normal) would
  // strobe. Coalesce to ~250ms with a guaranteed trailing edge so the final
  // state always lands.
  const fsThrottle = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: { designId: string; content: string } | null;
    lastFlushAt: number;
  }>({ timer: null, pending: null, lastFlushAt: 0 });
  const FS_THROTTLE_MS = 250;

  // Per-(designId, path) throttle for the wall view. Same shape and rate as
  // the index.html throttle above — multi-file generation can write to 5+
  // files in parallel and each card's iframe reloads on every srcDoc change,
  // so an unthrottled stream would strobe N cards simultaneously. Per-path
  // slots ensure each card flushes at most every FS_THROTTLE_MS while
  // letting different files update independently.
  const wallThrottles = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout> | null;
        pending: { designId: string; path: string; content: string } | null;
        lastFlushAt: number;
      }
    >
  >(new Map());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.codesign) return;
    const flushFs = () => {
      const slot = fsThrottle.current;
      slot.timer = null;
      const pending = slot.pending;
      slot.pending = null;
      if (!pending) return;
      slot.lastFlushAt = Date.now();
      setPreviewHtmlFromAgent(pending);
    };
    const scheduleFs = (next: { designId: string; content: string }) => {
      const slot = fsThrottle.current;
      slot.pending = next;
      const since = Date.now() - slot.lastFlushAt;
      if (since >= FS_THROTTLE_MS && slot.timer === null) {
        // Cold path: flush immediately, then a future event will land within
        // the throttle window and be coalesced.
        flushFs();
        return;
      }
      if (slot.timer !== null) return;
      slot.timer = setTimeout(flushFs, Math.max(FS_THROTTLE_MS - since, 0));
    };

    // Per-path throttle: wall cards get the same coalescing as the live
    // iframe so a 10-str_replace turn yields ~3 card refreshes, not 10.
    const flushWallSlot = (key: string) => {
      const slot = wallThrottles.current.get(key);
      if (!slot) return;
      slot.timer = null;
      const pending = slot.pending;
      slot.pending = null;
      if (!pending) return;
      slot.lastFlushAt = Date.now();
      recordAgentFileUpdate(pending);
    };
    const scheduleWallUpdate = (next: { designId: string; path: string; content: string }) => {
      const key = `${next.designId}::${next.path}`;
      let slot = wallThrottles.current.get(key);
      if (!slot) {
        slot = { timer: null, pending: null, lastFlushAt: 0 };
        wallThrottles.current.set(key, slot);
      }
      slot.pending = next;
      const since = Date.now() - slot.lastFlushAt;
      if (since >= FS_THROTTLE_MS && slot.timer === null) {
        flushWallSlot(key);
        return;
      }
      if (slot.timer !== null) return;
      slot.timer = setTimeout(() => flushWallSlot(key), Math.max(FS_THROTTLE_MS - since, 0));
    };

    const handleTurnStart = (event: AgentStreamEvent) => {
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_start', {
        generationId: event.generationId,
        designId: event.designId,
      });
      const previous = inFlight.current;
      const sameRun =
        previous &&
        previous.designId === event.designId &&
        previous.generationId === event.generationId;
      inFlight.current = {
        designId: event.designId,
        generationId: event.generationId,
        textBuffer: '',
        lastPersistedText: sameRun ? previous.lastPersistedText : null,
        pendingTools: sameRun ? previous.pendingTools : [],
      };
      setStreamingAssistantText({ designId: event.designId, text: '' });
    };

    const handleTextDelta = (event: AgentStreamEvent) => {
      if (!inFlight.current || typeof event.delta !== 'string') return;
      inFlight.current.textBuffer += event.delta;
      setStreamingAssistantText({
        designId: inFlight.current.designId,
        text: inFlight.current.textBuffer,
      });
    };

    const drainPendingTools = (current: InFlightTurn, finalStatus: 'done' | 'error'): void => {
      const designId = current.designId;
      const stragglers = current.pendingTools.filter((p) => !p.resolved);
      current.pendingTools = current.pendingTools.filter((p) => p.resolved);
      for (const p of stragglers) {
        p.resolved = true;
        void p.seqPromise.then((seq) => {
          if (seq === null) return;
          void updateChatToolStatus({ designId, seq, status: finalStatus });
        });
      }
    };

    const handleTurnEnd = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_end', {
        generationId: event.generationId,
        designId: event.designId,
        textLen: (event.finalText ?? current?.textBuffer ?? '').length,
      });
      const finalText = event.finalText ?? current?.textBuffer ?? '';
      const trimmed = finalText.trim();
      if (current && trimmed.length > 0 && trimmed !== current.lastPersistedText?.trim()) {
        void appendChatMessage({
          designId: current.designId,
          kind: 'assistant_text',
          payload: { text: finalText },
        });
        current.lastPersistedText = finalText;
      }
      if (current) drainPendingTools(current, 'done');
      setStreamingAssistantText(null);
      if (current) current.textBuffer = '';
    };

    const handleToolCallStart = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      const designId = event.designId;
      const toolName = event.toolName ?? 'unknown';
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] tool_call_start', {
        generationId: event.generationId,
        designId,
        toolName,
        toolCallId: event.toolCallId,
      });
      const payload = {
        toolName,
        ...(event.command !== undefined ? { command: event.command } : {}),
        args: event.args ?? {},
        status: 'running' as const,
        startedAt: new Date().toISOString(),
        verbGroup: event.verbGroup ?? 'Working',
        ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
      };
      // Surface the tool IMMEDIATELY in the store's pendingToolCalls so the
      // sidebar + preview banner show activity without waiting for the DB
      // round-trip. The persisted row that follows will dedupe on toolCallId.
      useCodesignStore.setState((s) => ({ pendingToolCalls: [...s.pendingToolCalls, payload] }));
      // DB row rather than an in-memory shadow. Capture seq via promise so
      // the result handler can patch the same row even if it lands before
      // the append round-trip completes.
      const seqPromise = appendChatMessage({
        designId,
        kind: 'tool_call',
        payload,
      }).then((row) => row?.seq ?? null);
      if (current) {
        current.pendingTools.push({
          seqPromise,
          toolName,
          toolCallId: event.toolCallId,
          resolved: false,
        });
      }
    };

    const handleToolCallResult = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      const designId = event.designId;
      // Pop the live banner entry no matter what the in-flight ref state is
      // (defensive: if turn_start never fired we still want the sidebar to
      // drain its running-tool chip).
      useCodesignStore.setState((s) => {
        const next = s.pendingToolCalls.filter((p) =>
          event.toolCallId !== undefined && p.toolCallId !== undefined
            ? p.toolCallId !== event.toolCallId
            : p.toolName !== (event.toolName ?? 'unknown'),
        );
        return next.length === s.pendingToolCalls.length ? s : { pendingToolCalls: next };
      });
      if (!current) return;
      const idx = current.pendingTools.findIndex(
        (p) =>
          !p.resolved &&
          (event.toolCallId !== undefined && p.toolCallId !== undefined
            ? p.toolCallId === event.toolCallId
            : p.toolName === (event.toolName ?? 'unknown')),
      );
      if (idx < 0) return;
      const pending = current.pendingTools[idx];
      if (!pending) return;
      pending.resolved = true;
      const result = event.result;
      const durationMs = event.durationMs;
      void pending.seqPromise.then((seq) => {
        if (seq === null) return;
        void updateChatToolStatus({
          designId,
          seq,
          status: 'done',
          ...(result !== undefined ? { result } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      });
    };

    const handleFsUpdated = (event: AgentStreamEvent) => {
      if (typeof event.content !== 'string' || typeof event.path !== 'string') return;
      // Read-only seed paths the host injects (frames/, skills/) live in the
      // agent's virtual fs but never come back as user-authored output. Skip
      // them so they don't pollute the wall view.
      if (event.path.startsWith('frames/') || event.path.startsWith('skills/')) return;
      // Live iframe mirror only fires for index.html — that's what the active
      // iframe shows during a generation. Multi-file walls don't live-render
      // mid-turn; their cards refresh on agent_end via the per-file cache.
      if (event.path === 'index.html') {
        scheduleFs({ designId: event.designId, content: event.content });
      }
      // Always update the per-file cache + persist for ANY HTML file the
      // agent writes — that's what the wall view reads. Throttled per-path
      // so each card re-renders at most every FS_THROTTLE_MS even when the
      // agent fires str_replace bursts across multiple files.
      if (event.path.toLowerCase().endsWith('.html') && !event.path.startsWith('turn-')) {
        scheduleWallUpdate({
          designId: event.designId,
          path: event.path,
          content: event.content,
        });
      }
    };

    const handleError = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      // TODO: replace with rendererLogger once renderer-logger lands
      console.error('[agent] error', {
        generationId: event.generationId,
        designId: event.designId,
        message: event.message,
        code: event.code,
      });
      useCodesignStore.setState({ pendingToolCalls: [] });
      setStreamingAssistantText(null);
      inFlight.current = null;
      void appendChatMessage({
        designId: event.designId,
        kind: 'error',
        payload: {
          message: event.message ?? 'Unknown error',
          ...(event.code ? { code: event.code } : {}),
        },
      });
      // Defensive: clear generation flags so the UI never gets stuck showing
      // "running" if the IPC promise that drives sendPrompt hangs. Only clear
      // when the error belongs to the design the store thinks is generating.
      const s = useCodesignStore.getState();
      if (s.generatingDesignId === event.designId) {
        useCodesignStore.setState({
          isGenerating: false,
          generatingDesignId: null,
          generationStage: 'error',
          streamingAssistantText: null,
        });
      }
    };

    const handleAgentEnd = (event: AgentStreamEvent) => {
      // Any tools still showing "running" at run end would stick forever
      // (their result event never arrived). Drain the live tray — the
      // persisted DB rows are the source of truth once the run is done.
      useCodesignStore.setState({ pendingToolCalls: [] });
      // Flush any throttled fs_updated payload synchronously so the preview
      // store reflects the final html before we read it back for persistence.
      const slot = fsThrottle.current;
      if (slot.timer !== null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      const pending = slot.pending;
      slot.pending = null;
      if (pending) {
        slot.lastFlushAt = Date.now();
        setPreviewHtmlFromAgent(pending);
      }
      // Same drain for the per-path wall throttles so any in-flight final
      // edit lands in previewHtmlByFile before persistence reads from it.
      for (const [key, wallSlot] of wallThrottles.current) {
        if (wallSlot.timer !== null) {
          clearTimeout(wallSlot.timer);
          wallSlot.timer = null;
        }
        const wallPending = wallSlot.pending;
        wallSlot.pending = null;
        if (wallPending) {
          wallSlot.lastFlushAt = Date.now();
          recordAgentFileUpdate(wallPending);
        }
        // Drop slot entirely — a new run starts a fresh map.
        wallThrottles.current.delete(key);
      }
      const finalText = inFlight.current?.lastPersistedText ?? undefined;
      void persistAgentRunSnapshot({
        designId: event.designId,
        ...(finalText ? { finalText } : {}),
      });
      inFlight.current = null;
      // Defensive: clear generation flags. The sendPrompt Promise resolution
      // would normally clear them shortly after, but if the main-process IPC
      // hangs for any reason the UI would be stuck in "running" forever.
      // Mirror the happy-path terminal state here as a belt-and-suspenders.
      const s = useCodesignStore.getState();
      if (s.generatingDesignId === event.designId) {
        useCodesignStore.setState({
          isGenerating: false,
          generatingDesignId: null,
          generationStage: 'done',
          streamingAssistantText: null,
        });
      }
      // Fire the auto-polish follow-up exactly once per design. Delay so the
      // isGenerating flag and persisted assistant_text row have settled before
      // sendPrompt inspects them. The guard inside tryAutoPolish dedupes.
      const designId = event.designId;
      setTimeout(() => {
        // Locale is read from the i18n module the renderer already initialised.
        // Fall back to 'en' if i18next isn't ready yet (shouldn't happen in
        // practice — agent_end implies the UI has been running for a while).
        let locale = 'en';
        try {
          const i18n = (globalThis as { i18next?: { language?: string } }).i18next;
          if (i18n?.language) locale = i18n.language;
        } catch {
          /* noop */
        }
        useCodesignStore.getState().tryAutoPolish(designId, locale);
      }, 1200);
    };

    const off = window.codesign.chat.onAgentEvent((event: AgentStreamEvent) => {
      switch (event.type) {
        case 'turn_start':
          handleTurnStart(event);
          return;
        case 'text_delta':
          handleTextDelta(event);
          return;
        case 'turn_end':
          handleTurnEnd(event);
          return;
        case 'tool_call_start':
          handleToolCallStart(event);
          return;
        case 'tool_call_result':
          handleToolCallResult(event);
          return;
        case 'fs_updated':
          handleFsUpdated(event);
          return;
        case 'agent_end':
          handleAgentEnd(event);
          return;
        case 'error':
          handleError(event);
          return;
      }
    });
    return () => {
      off();
      const slot = fsThrottle.current;
      if (slot.timer !== null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      slot.pending = null;
    };
  }, [
    appendChatMessage,
    setStreamingAssistantText,
    setPreviewHtmlFromAgent,
    recordAgentFileUpdate,
    updateChatToolStatus,
    persistAgentRunSnapshot,
  ]);
}

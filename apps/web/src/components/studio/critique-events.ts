/**
 * The one reduction from a `DesignCriticEvent` to what the critique lane
 * renders — the shared vocabulary between the live SSE stream and transcript
 * replay.
 *
 * `use-design.ts`'s live handler applies this exact shape inline today
 * (`on<DesignCriticEvent>(DESIGN_SSE_EVENTS.critic, ...)`); `use-critique-replay.ts`
 * applies it per replayed event. Neither the lane nor its speed control needs
 * to know which source an event came from — both end up as one
 * `CritiqueLiveState`, rendered by one set of JSX branches.
 */

import type { CritiqueReport, DesignCriticEvent } from '@ligma/api';

export interface CritiqueLiveState {
  critique: CritiqueReport | null;
  /** Rule the critic is on right now — mirrors `use-design.ts`'s `criticRule`. */
  currentRule: string | null;
  /** Panelist the current rule belongs to. Null between lanes. */
  currentLane: string | null;
}

export const CRITIQUE_IDLE: CritiqueLiveState = {
  critique: null,
  currentRule: null,
  currentLane: null,
};

export function reduceCriticEvent(
  prev: CritiqueLiveState,
  payload: DesignCriticEvent,
): CritiqueLiveState {
  const lanes = prev.critique?.lanes ?? [];
  return {
    currentRule: payload.rule?.rule ?? null,
    // A `lane` frame closes a panelist rather than scoring inside one, so the
    // ticker goes quiet between lanes instead of holding the last one's name.
    currentLane: payload.rule ? (payload.lane ?? null) : null,
    critique: {
      status: payload.status,
      // Null unless scored — a critic malfunction is `error`, never a 0.
      score: payload.status === 'scored' ? payload.score : null,
      threshold: payload.threshold,
      rules: payload.rule
        ? [...(prev.critique?.rules ?? []), payload.rule]
        : (prev.critique?.rules ?? []),
      designSystem: prev.critique?.designSystem ?? null,
      error: payload.error,
      startedAt: prev.critique?.startedAt ?? new Date().toISOString(),
      finishedAt: payload.phase === 'end' ? new Date().toISOString() : null,
      // Verbatim: a lane's own verdict — skipped, errored or scored — is the
      // one thing this reducer must never reinterpret.
      lanes: payload.laneReport ? [...lanes, payload.laneReport] : lanes,
    },
  };
}

/**
 * The harness's pinned types now live in `@ligma/api` — the one package web,
 * cli and daemon share (see docs/history/CONTRACTS-phase2.md). This module stays as the
 * harness's local name for them, so every harness file keeps importing
 * "./types" and the definitions exist exactly once.
 */
export type * from '@ligma/api/harness';

/**
 * Verification-side shapes served by the daemon's /api/verification-runs and
 * /api/contracts routes.
 *
 * The harness's pinned contract types live in ./harness (single source of
 * truth, see docs/history/CONTRACTS.md); this module is the API-facing view of them
 * plus the shapes that only exist on the wire.
 */
export type {
  CriterionKind,
  CriterionProvenance,
  Criterion,
  HarnessSignature,
  AcceptanceContract,
  PersonaCharter,
  PersonaFinding,
  PersonaCriterionResult,
  PersonaReport,
  CriterionVerdictStatus,
  CriterionVerdict,
  VerificationVerdict,
  VerificationRunManifest,
  BridgeStep,
} from './harness';

/** One file inside a run's evidence dir, as listed by /api/verification-runs/[id]/artifacts. */
export interface RunArtifact {
  /** Path relative to the run root — feed straight to the /file route. */
  path: string;
  size: number;
  kind: 'screenshot' | 'steps' | 'transcript' | 'report' | 'other';
}

import { useCodesignStore } from '../../store';

type Fidelity = 'wireframe' | 'highFidelity';

const LABELS: Record<Fidelity, string> = {
  wireframe: 'Wireframe',
  highFidelity: 'Hi-fi',
};

/**
 * FidelityChip — per-design fidelity selector.
 *
 * Three states cycle on click:
 *   (none — model picks) → Wireframe → Hi-fi → (none)
 *
 * When a value is set, the next generate payload carries `fidelity` so
 * the core prompt composer injects WIREFRAME_PRESET or HI_FIDELITY_PRESET.
 * When cleared, the model picks based on the brief (today's default).
 */
export function FidelityChip() {
  const designId = useCodesignStore((s) => s.currentDesignId);
  const fidelity = useCodesignStore((s) => (designId ? s.fidelityByDesign[designId] : undefined));
  const setFidelity = useCodesignStore((s) => s.setFidelity);

  if (!designId) return null;

  const cycle = (): Fidelity | null => {
    if (fidelity === undefined) return 'wireframe';
    if (fidelity === 'wireframe') return 'highFidelity';
    return null;
  };

  const label = fidelity ? LABELS[fidelity] : 'Auto fidelity';
  const active = fidelity !== undefined;

  return (
    <button
      type="button"
      onClick={() => setFidelity(designId, cycle())}
      title={`Fidelity: ${label}. Click to change.`}
      aria-label={`Fidelity: ${label}`}
      aria-pressed={active}
      className={`inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[5px] text-[11px] transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-muted,transparent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block w-[8px] h-[8px] rounded-full ${active ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)] opacity-40'}`}
      />
      <span>{label}</span>
    </button>
  );
}

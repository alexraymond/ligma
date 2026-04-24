import { useT } from '@ligma/i18n';
import { Plus } from 'lucide-react';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useRef,
  useState,
} from 'react';
import { useCodesignStore } from '../store';

type Fidelity = 'auto' | 'wireframe' | 'highFidelity';
const FIDELITY_ORDER: readonly Fidelity[] = ['auto', 'wireframe', 'highFidelity'];

function nextFidelity(current: Fidelity): Fidelity {
  const i = FIDELITY_ORDER.indexOf(current);
  return FIDELITY_ORDER[(i + 1) % FIDELITY_ORDER.length] ?? 'auto';
}

interface ChipProps {
  label: string;
  value: string;
  onClick?: () => void;
  title?: string;
}

function Chip({ label, value, onClick, title }: ChipProps): ReactElement {
  const chipStyle: CSSProperties = {
    fontFamily: 'var(--font-hand)',
    fontWeight: 500,
    fontSize: '17px',
    color: 'var(--color-text-secondary)',
    padding: '0 3px 2px',
    borderBottom: '1px solid var(--color-rule)',
    whiteSpace: 'nowrap',
    lineHeight: 1,
    background: 'transparent',
    cursor: onClick ? 'pointer' : 'default',
  };
  return (
    <button type="button" onClick={onClick} title={title} style={chipStyle}>
      {label}: <b style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{value}</b>
    </button>
  );
}

/**
 * Top-strip quick-prompt. Typing + Enter bootstraps a design and sends the
 * prompt via `submitHomePrompt`. For anything richer — workspace folder,
 * design-system link, file uploads, reference URL — the chips and the "+"
 * button open `NewProjectModal`, which owns the full new-project composer.
 */
export function HomePromptBar(): ReactElement {
  const t = useT();
  const submitHomePrompt = useCodesignStore((s) => s.submitHomePrompt);
  const openNewProjectModal = useCodesignStore((s) => s.openNewProjectModal);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const [prompt, setPrompt] = useState('');
  const [fidelity, setFidelity] = useState<Fidelity>('auto');
  const taRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: FormEvent | KeyboardEvent): void {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || isGenerating) return;
    void submitHomePrompt({
      prompt: trimmed,
      fidelity: fidelity === 'auto' ? null : fidelity,
    });
    setPrompt('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  }

  const empty = prompt.length === 0;
  const fidelityLabel =
    fidelity === 'auto' ? t('home.chip.auto') : t(`home.chip.${fidelity}` as const);

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex items-center gap-[14px] w-full"
      style={{
        padding: '8px 12px 11px',
        marginRight: 14,
      }}
    >
      <span
        aria-hidden
        className="ligma-caret shrink-0"
        style={{ visibility: empty ? 'visible' : 'hidden' }}
      />
      <textarea
        ref={taRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('home.prompt.placeholder')}
        rows={1}
        disabled={isGenerating}
        className="codesign-prompt-textarea flex-1 resize-none appearance-none border-0 bg-transparent shadow-none outline-none focus:outline-none focus:ring-0"
        style={{
          fontFamily: empty ? 'var(--font-hand)' : 'var(--font-display)',
          fontSize: empty ? '22px' : '18px',
          fontStyle: empty ? 'italic' : 'normal',
          fontWeight: 500,
          color: empty ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
          lineHeight: 1.1,
          minHeight: 22,
          padding: 0,
        }}
      />
      <div className="flex gap-[12px] items-center shrink-0">
        <Chip
          label={t('home.chip.workspace')}
          value={t('home.chip.none')}
          onClick={openNewProjectModal}
          title={t('newProject.workspace.pick')}
        />
        <Chip
          label={t('home.chip.fidelity')}
          value={fidelityLabel}
          onClick={() => setFidelity(nextFidelity(fidelity))}
          title={fidelityLabel}
        />
        <Chip
          label={t('home.chip.designSystem')}
          value={t('home.chip.none')}
          onClick={openNewProjectModal}
          title={t('newProject.designSystem.label')}
        />
        <button
          type="button"
          onClick={openNewProjectModal}
          aria-label={t('home.prompt.addAttachment')}
          title={t('newProject.title')}
          className="inline-flex items-center justify-center shrink-0"
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--color-accent)',
            color: 'var(--color-paper-card)',
            border: 'none',
            transform: 'rotate(-4deg)',
            boxShadow: 'var(--shadow-tilt-badge)',
            cursor: 'pointer',
          }}
        >
          <Plus width={14} height={14} strokeWidth={2.5} />
        </button>
      </div>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 0,
          borderBottom: '2px dashed var(--color-accent)',
          pointerEvents: 'none',
        }}
      />
    </form>
  );
}

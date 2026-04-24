import { useT } from '@ligma/i18n';
import type { DesignSystemRow } from '@ligma/shared';
import { ArrowUp, Check, ChevronDown, FolderOpen, Layers, Link2, Paperclip, X } from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { basename } from '../lib/path-basename';
import { useCodesignStore } from '../store';

type Fidelity = 'auto' | 'wireframe' | 'highFidelity';

const FIDELITY_LABELS: Record<Fidelity, string> = {
  auto: 'auto',
  wireframe: 'wireframe',
  highFidelity: 'high-fidelity',
};

/**
 * Rich "Start a new project" composer. Replaces the single-line top-strip
 * prompt as the primary entry point: users pick a workspace folder, link a
 * design system, attach files, set fidelity, and paste a reference URL —
 * all before creating the design so none of those settings land on the
 * wrong record. On submit: createNewDesign → apply settings → switchDesign
 * → setView('workspace') → sendPrompt (globals `inputFiles` + `referenceUrl`
 * flow through automatically).
 */
export function NewProjectModal(): ReactElement | null {
  const t = useT();
  const open = useCodesignStore((s) => s.newProjectModalOpen);
  const close = useCodesignStore((s) => s.closeNewProjectModal);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const setView = useCodesignStore((s) => s.setView);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const setWorkspaceForDesign = useCodesignStore((s) => s.setWorkspaceForDesign);
  const setFidelity = useCodesignStore((s) => s.setFidelity);
  const pickInputFiles = useCodesignStore((s) => s.pickInputFiles);
  const addClipboardImage = useCodesignStore((s) => s.addClipboardImage);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const clearInputFiles = useCodesignStore((s) => s.clearInputFiles);
  const setReferenceUrl = useCodesignStore((s) => s.setReferenceUrl);
  const inputFiles = useCodesignStore((s) => s.inputFiles);
  const referenceUrl = useCodesignStore((s) => s.referenceUrl);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [prompt, setPrompt] = useState('');
  const [workspaceCwd, setWorkspaceCwd] = useState<string | null>(null);
  const [fidelity, setLocalFidelity] = useState<Fidelity>('auto');
  const [designSystems, setDesignSystems] = useState<DesignSystemRow[]>([]);
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  const [dsOpen, setDsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dsRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setPrompt('');
    setWorkspaceCwd(null);
    setLocalFidelity('auto');
    setDesignSystemId(null);
    setDsOpen(false);
    setReferenceUrl('');
    clearInputFiles();
  }, [setReferenceUrl, clearInputFiles]);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    if (window.codesign?.designSystems) {
      void window.codesign.designSystems.list().then(setDesignSystems);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        close();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, submitting]);

  useEffect(() => {
    if (!dsOpen) return;
    function onDown(e: MouseEvent) {
      if (dsRef.current && !dsRef.current.contains(e.target as Node)) setDsOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dsOpen]);

  if (!open) return null;

  async function handlePickWorkspace() {
    if (!window.codesign?.workspace) return;
    const picked = await window.codesign.workspace.pickDirectory();
    if (picked !== null) setWorkspaceCwd(picked);
  }

  async function handleSubmit() {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || submitting || isGenerating) return;
    setSubmitting(true);
    try {
      const design = await createNewDesign();
      if (!design) {
        setSubmitting(false);
        return;
      }
      // Switch first so App.tsx's `currentDesignId` effect runs its
      // `loadWorkspaceForDesign` against the fresh design (which has no
      // workspace yet — fine). Then apply settings. If we applied settings
      // BEFORE switch, the effect could read the main map before the IPC
      // write had propagated and clobber the renderer map with null.
      await switchDesign(design.id);
      setView('workspace');
      if (workspaceCwd !== null) {
        await setWorkspaceForDesign(design.id, { cwd: workspaceCwd });
      }
      if (fidelity !== 'auto') {
        setFidelity(design.id, fidelity);
      }
      if (designSystemId !== null && window.codesign?.designSystems) {
        try {
          await window.codesign.designSystems.linkToDesign(design.id, designSystemId);
        } catch (err) {
          pushToast({
            variant: 'error',
            title: 'Could not link design system',
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Fire sendPrompt without awaiting so the modal closes immediately.
      // sendPrompt blocks until the whole generation finishes — awaiting
      // it keeps the modal open for minutes. The generation still runs
      // correctly in the background; the workspace / attachments / url
      // are snapshotted at the start of the call.
      void sendPrompt({ prompt: trimmed });
      reset();
      close();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not start project',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onPromptKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Meta+Enter submits even from the multi-line textarea.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function onPromptPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!clipboardHasImage(e.clipboardData)) return;
    e.preventDefault();
    void addClipboardImage();
  }

  function onUrlChange(e: ChangeEvent<HTMLInputElement>) {
    setReferenceUrl(e.target.value);
  }

  const selectedDs = designSystems.find((d) => d.id === designSystemId) ?? null;
  const canSubmit = prompt.trim().length > 0 && !submitting && !isGenerating;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: 'var(--color-overlay)', padding: '60px 24px' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) close();
      }}
    >
      <div
        className="relative w-full max-w-[640px]"
        style={{
          background: 'var(--color-paper-card)',
          border: '1px solid var(--color-pencil-faint)',
          boxShadow: 'var(--shadow-elevated)',
          padding: '32px 32px 24px',
          transform: 'rotate(-0.3deg)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: -6,
            left: '50%',
            marginLeft: -20,
            width: 40,
            height: 10,
            background: 'var(--color-accent)',
            opacity: 0.9,
            transform: 'rotate(-3deg)',
            boxShadow: 'var(--shadow-tape)',
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (!submitting) close();
          }}
          aria-label={t('common.close')}
          className="absolute top-[12px] right-[12px]"
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>

        <h2
          id="new-project-title"
          className="m-0 ligma-pencil-oval"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: 13,
            textTransform: 'uppercase',
            letterSpacing: '0.24em',
            color: 'var(--color-text-primary)',
            marginBottom: 20,
          }}
        >
          {t('newProject.title')}
        </h2>

        <div className="flex flex-col" style={{ gap: 16 }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            onPaste={(e) => void onPromptPaste(e)}
            placeholder={t('newProject.promptPlaceholder')}
            rows={5}
            className="w-full resize-none focus:outline-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              lineHeight: 1.45,
              color: 'var(--color-text-primary)',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px dashed var(--color-rule)',
              padding: '0 0 12px',
            }}
          />

          <Row
            icon={<FolderOpen className="w-4 h-4" aria-hidden />}
            label={t('newProject.workspace.label')}
          >
            {workspaceCwd !== null ? (
              <div className="flex items-center gap-[var(--space-2)]">
                <span
                  className="truncate"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                    maxWidth: 280,
                  }}
                  title={workspaceCwd}
                >
                  {basename(workspaceCwd)}
                </span>
                <button
                  type="button"
                  onClick={() => setWorkspaceCwd(null)}
                  aria-label={t('newProject.workspace.clear')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </div>
            ) : (
              <RowButton onClick={handlePickWorkspace}>{t('newProject.workspace.pick')}</RowButton>
            )}
          </Row>

          <Row
            icon={<Layers className="w-4 h-4" aria-hidden />}
            label={t('newProject.designSystem.label')}
          >
            <div ref={dsRef} className="relative">
              <button
                type="button"
                onClick={() => setDsOpen((v) => !v)}
                className="inline-flex items-center gap-[6px]"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 13,
                  color: selectedDs ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span>{selectedDs ? selectedDs.name : t('newProject.designSystem.none')}</span>
                <ChevronDown className="w-3 h-3" aria-hidden />
              </button>
              {dsOpen ? (
                <div
                  role="listbox"
                  className="absolute top-full left-0 mt-[4px] z-10 min-w-[240px] max-h-[220px] overflow-y-auto"
                  style={{
                    background: 'var(--color-paper-card)',
                    border: '1px solid var(--color-rule)',
                    boxShadow: 'var(--shadow-card)',
                    padding: 4,
                  }}
                >
                  <DsOption
                    label={t('newProject.designSystem.none')}
                    selected={designSystemId === null}
                    onClick={() => {
                      setDesignSystemId(null);
                      setDsOpen(false);
                    }}
                  />
                  {designSystems.map((row) => (
                    <DsOption
                      key={row.id}
                      label={row.name}
                      sub={row.rootPath}
                      selected={designSystemId === row.id}
                      onClick={() => {
                        setDesignSystemId(row.id);
                        setDsOpen(false);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </Row>

          <Row label={t('newProject.fidelity.label')}>
            <FidelityPills value={fidelity} onChange={setLocalFidelity} />
          </Row>

          <Row
            icon={<Paperclip className="w-4 h-4" aria-hidden />}
            label={t('newProject.files.label')}
          >
            <RowButton onClick={() => void pickInputFiles()}>
              {t('newProject.files.pick')}
            </RowButton>
          </Row>
          {inputFiles.length > 0 ? (
            <div className="flex flex-wrap" style={{ gap: 6, paddingLeft: 28 }}>
              {inputFiles.map((file) => (
                <span
                  key={file.path}
                  className="inline-flex items-center gap-[4px]"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    background: 'var(--color-paper-shade)',
                    padding: '3px 8px',
                    border: '1px solid var(--color-rule-subtle)',
                    maxWidth: 220,
                  }}
                  title={file.path}
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeInputFile(file.path)}
                    aria-label={`Remove ${file.name}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <Row icon={<Link2 className="w-4 h-4" aria-hidden />} label={t('newProject.url.label')}>
            <input
              type="url"
              value={referenceUrl}
              onChange={onUrlChange}
              placeholder={t('newProject.url.placeholder')}
              className="flex-1 focus:outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--color-text-primary)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px dashed var(--color-rule-subtle)',
                padding: '4px 0',
              }}
            />
          </Row>
        </div>

        <div
          className="flex items-center justify-between"
          style={{ marginTop: 24, paddingTop: 16, borderTop: '1px dashed var(--color-rule)' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-hand)',
              fontSize: 14,
              fontStyle: 'italic',
              color: 'var(--color-text-muted)',
            }}
          >
            {t('newProject.hint')}
          </span>
          <div className="flex items-center gap-[var(--space-3)]">
            <button
              type="button"
              onClick={() => {
                if (!submitting) close();
              }}
              disabled={submitting}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                background: 'transparent',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                padding: '6px 10px',
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="inline-flex items-center gap-[6px]"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-on-accent)',
                background: 'var(--color-accent)',
                border: 'none',
                padding: '8px 16px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.5,
                boxShadow: 'var(--shadow-tilt-badge)',
                transform: 'rotate(-0.5deg)',
              }}
            >
              <span>{t('newProject.submit')}</span>
              <ArrowUp className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clipboardHasImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return true;
  }
  for (const f of Array.from(data.files ?? [])) {
    if (f.type.startsWith('image/')) return true;
  }
  // macOS screenshots / screen captures announce "Files" in types without
  // populating items in some cases; fall back to the types list.
  return Array.from(data.types ?? []).some((t) => t.startsWith('image/'));
}

function Row({
  icon,
  label,
  children,
}: {
  icon?: ReactElement;
  label: string;
  children: ReactElement | ReactElement[] | string;
}): ReactElement {
  return (
    <div className="flex items-center" style={{ gap: 12, minHeight: 28 }}>
      <span
        className="inline-flex items-center gap-[6px] shrink-0"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          minWidth: 120,
        }}
      >
        {icon}
        {label}
      </span>
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
    </div>
  );
}

function RowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-hand)',
        fontSize: 16,
        fontStyle: 'italic',
        color: 'var(--color-accent)',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px dashed var(--color-accent)',
        padding: '0 2px 2px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function DsOption({
  label,
  sub,
  selected,
  onClick,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex items-start gap-[var(--space-2)] w-full text-left"
      style={{
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-display)',
      }}
    >
      {selected ? (
        <Check
          className="w-3 h-3 shrink-0 mt-[4px]"
          aria-hidden
          style={{ color: 'var(--color-accent)' }}
        />
      ) : (
        <span className="w-3 shrink-0" aria-hidden />
      )}
      <span className="flex flex-col min-w-0">
        <span
          className="truncate"
          style={{
            fontSize: 13,
            color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)',
          }}
        >
          {label}
        </span>
        {sub ? (
          <span
            className="truncate"
            style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {sub}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function FidelityPills({
  value,
  onChange,
}: {
  value: Fidelity;
  onChange: (v: Fidelity) => void;
}): ReactElement {
  const options: Fidelity[] = ['auto', 'wireframe', 'highFidelity'];
  return (
    <div className="inline-flex" style={{ gap: 6 }}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              fontFamily: 'var(--font-hand)',
              fontSize: 16,
              fontWeight: 500,
              color: active ? 'var(--color-on-accent)' : 'var(--color-text-secondary)',
              background: active ? 'var(--color-accent)' : 'transparent',
              border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-rule)'}`,
              padding: '2px 10px',
              cursor: 'pointer',
              transform: active ? 'rotate(-1deg)' : 'rotate(0deg)',
              boxShadow: active ? 'var(--shadow-tilt-badge)' : 'none',
            }}
          >
            {FIDELITY_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}

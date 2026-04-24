import { useT } from '@ligma/i18n';
import { Paperclip } from 'lucide-react';

interface UserMessageProps {
  text: string;
  attachedSkills?: string[];
  attachments?: Array<{ name: string; path: string; size: number }>;
}

function basename(p: string): string {
  const segs = p.split('/');
  return segs[segs.length - 1] ?? p;
}

/**
 * Claude-style user message: right-aligned bubble with subtle accent tint
 * background. No "You" label — bubble alignment carries the role signal.
 */
export function UserMessage({ text, attachedSkills, attachments }: UserMessageProps) {
  const t = useT();
  const hasAttachments = attachments && attachments.length > 0;
  return (
    <div className="flex flex-col items-end gap-[var(--space-1)] pl-[var(--space-6)]">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-[var(--space-3)] py-[var(--space-2)] text-[14px] leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
        {text}
      </div>
      {hasAttachments ? (
        <div className="flex flex-wrap justify-end gap-[var(--space-1)] max-w-[85%]">
          {attachments.map((a) => (
            <span
              key={a.path}
              title={a.path}
              className="inline-flex items-center gap-[var(--space-1)] rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-[var(--space-2)] py-[var(--space-0_5)] text-[var(--text-2xs)] text-[var(--color-accent)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              <Paperclip className="w-[10px] h-[10px]" aria-hidden />
              <span className="truncate max-w-[220px]">{basename(a.name)}</span>
            </span>
          ))}
        </div>
      ) : null}
      {attachedSkills && attachedSkills.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-[var(--space-1)]">
          {attachedSkills.map((s) => (
            <span
              key={s}
              className="inline-flex items-center rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-0_5)] text-[var(--text-2xs)] text-[var(--color-text-muted)]"
            >
              {t(`sidebar.chat.skill.${s}`, { defaultValue: s })}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

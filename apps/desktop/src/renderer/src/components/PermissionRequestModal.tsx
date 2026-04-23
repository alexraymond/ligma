import type { PermissionRequest } from '@ligma/shared';
import { useCodesignStore } from '../store';

/**
 * Summarize a tool call's input for the permission prompt body. Different
 * tools carry different shapes; we show the most load-bearing field so the
 * user can make a decision at a glance. Unknown tools fall back to the raw
 * JSON snippet (truncated) so nothing is hidden.
 */
function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  const asString = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const path = asString(input['file_path']) ?? asString(input['path']);
      if (path !== null) return path;
      break;
    }
    case 'Glob': {
      const pattern = asString(input['pattern']);
      const path = asString(input['path']);
      if (pattern !== null) return path !== null ? `${pattern} in ${path}` : pattern;
      break;
    }
    case 'Grep': {
      const pattern = asString(input['pattern']);
      const path = asString(input['path']);
      if (pattern !== null)
        return path !== null ? `pattern ${pattern} in ${path}` : `pattern ${pattern}`;
      break;
    }
    case 'Bash': {
      const command = asString(input['command']);
      if (command !== null) return command.length > 160 ? `${command.slice(0, 157)}…` : command;
      break;
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url = asString(input['url']) ?? asString(input['query']);
      if (url !== null) return url;
      break;
    }
    default:
      break;
  }
  const json = JSON.stringify(input);
  return json.length > 240 ? `${json.slice(0, 237)}…` : json;
}

interface PermissionRowProps {
  label: string;
  value: string;
}

function PermissionRow({ label, value }: PermissionRowProps) {
  return (
    <div className="flex gap-3 text-[var(--text-sm)] leading-[var(--leading-body)]">
      <div className="w-20 shrink-0 text-[var(--color-text-secondary)] uppercase tracking-[0.08em] text-[11px] pt-[2px]">
        {label}
      </div>
      <div className="flex-1 font-mono text-[12.5px] text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
  );
}

export function PermissionRequestModal() {
  const request = useCodesignStore(
    (s): PermissionRequest | null => s.pendingPermissions[0] ?? null,
  );
  const resolvePermission = useCodesignStore((s) => s.resolvePermission);

  if (!request) return null;

  const allow = () => {
    resolvePermission({ requestId: request.requestId, behavior: 'allow' });
  };
  const deny = () => {
    resolvePermission({
      requestId: request.requestId,
      behavior: 'deny',
      message: 'User declined this tool call.',
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Permission request: ${request.toolName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') deny();
      }}
    >
      <div
        role="document"
        className="w-full max-w-md rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <div className="space-y-1">
          <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
            Claude wants to use {request.toolName}
          </h3>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            Approve this tool call so the agent can continue, or deny to block this step.
          </p>
        </div>

        <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] p-3">
          <PermissionRow label="Tool" value={request.toolName} />
          <PermissionRow label="Input" value={summarizeInput(request.toolName, request.input)} />
          {request.blockedPath !== undefined && request.blockedPath.length > 0 ? (
            <PermissionRow label="Blocked" value={request.blockedPath} />
          ) : null}
          {request.decisionReason !== undefined && request.decisionReason.length > 0 ? (
            <PermissionRow label="Reason" value={request.decisionReason} />
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={deny}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={allow}
            className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

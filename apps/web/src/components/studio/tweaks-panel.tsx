'use client';

/**
 * The tweaks panel — agent-declared tokens as instant controls.
 *
 * Ported from ligma-classic's `TweakPanel.tsx` (studio map §1, "EDITMODE tweaks
 * bridge"). Two behaviours carry over:
 *
 *  - **The schema is advisory.** A token the agent forgot to declare still gets
 *    a control, inferred from its value's shape (`controlFor`), so the panel
 *    never silently drops a token.
 *  - **`live` tokens apply without a regeneration.** The daemon substitutes the
 *    value straight into the EDITMODE block — no model spawn, so no governor
 *    slot (`TweakControl.live`). Non-live tokens fall through to a real turn,
 *    and the button says so rather than pretending both are the same.
 *
 * Controls are native inputs — `range`, `color`, `checkbox`, `select`. The
 * platform already ships the pickers this needs.
 */

import { Button } from '@/components/ui/button';
import type { TweakControl, TweakSchema, TweakValue, TweakValues } from '@ligma/api';
import { Sliders, Zap } from 'lucide-react';
import { useState } from 'react';
import { controlFor } from './api';

export interface TweaksPanelProps {
  schema: TweakSchema | null;
  values: TweakValues;
  disabled?: boolean;
  onApply: (values: TweakValues) => void;
}

function Control({
  token,
  control,
  value,
  onChange,
  disabled,
}: {
  token: string;
  control: TweakControl;
  value: TweakValue;
  onChange: (next: TweakValue) => void;
  disabled?: boolean;
}) {
  const id = `tweak-${token}`;
  switch (control.kind) {
    case 'color':
      return (
        <input
          id={id}
          type="color"
          disabled={disabled}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border bg-transparent p-0.5"
        />
      );
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="range"
            disabled={disabled}
            min={control.min ?? 0}
            max={control.max ?? 100}
            step={control.step ?? 1}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {String(value)}
            {control.unit ?? ''}
          </span>
        </div>
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
      );
    case 'enum':
      return (
        <select
          id={id}
          disabled={disabled}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full rounded border bg-background px-2 text-xs"
        >
          {(control.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          id={id}
          type="text"
          disabled={disabled}
          placeholder={control.placeholder}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full rounded border bg-background px-2 text-xs"
        />
      );
  }
}

export function TweaksPanel({ schema, values, disabled, onApply }: TweaksPanelProps) {
  const [draft, setDraft] = useState<TweakValues>({});

  const tokens = Object.keys({ ...values, ...(schema ?? {}) }).sort();
  if (tokens.length === 0) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        No tweak schema yet. The designer declares one with `declare_tweak_schema` when it writes
        design tokens.
      </p>
    );
  }

  const merged: TweakValues = { ...values, ...draft };
  const dirty = Object.keys(draft).filter((token) => draft[token] !== values[token]);
  const allLive = dirty.every((token) => controlFor(schema?.[token], merged[token]).live);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <Sliders className="h-4 w-4" aria-hidden />
        Tweaks
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tokens.map((token) => {
          const value = merged[token] ?? '';
          const control = controlFor(schema?.[token], value);
          return (
            <div key={token} className="space-y-1">
              <label
                htmlFor={`tweak-${token}`}
                className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
              >
                {token}
                {control.live ? (
                  <Zap
                    className="h-3 w-3 text-amber-500"
                    aria-label="applies without a regeneration"
                  />
                ) : null}
              </label>
              <Control
                token={token}
                control={control}
                value={value}
                disabled={disabled}
                onChange={(next) => setDraft((prev) => ({ ...prev, [token]: next }))}
              />
            </div>
          );
        })}
      </div>

      <footer className="border-t p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={disabled || dirty.length === 0}
          onClick={() => {
            onApply(Object.fromEntries(dirty.map((token) => [token, merged[token]])));
            setDraft({});
          }}
        >
          {dirty.length === 0
            ? 'No changes'
            : allLive
              ? `Apply ${dirty.length} live tweak${dirty.length === 1 ? '' : 's'}`
              : `Regenerate with ${dirty.length} tweak${dirty.length === 1 ? '' : 's'}`}
        </Button>
        {dirty.length > 0 ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {allLive
              ? 'Live tokens are substituted directly — no model spawn, no governor slot.'
              : 'At least one token is not live, so this takes a generation turn.'}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDaemon } from '@/hooks/use-daemon';
import { Gauge, OctagonX, Pencil, Save, X } from 'lucide-react';
import { useState } from 'react';

type Backend = 'claude' | 'codex' | 'gemini';
const ROLES: { key: 'builder' | 'persona' | 'judge' | 'scheduled'; label: string }[] = [
  { key: 'builder', label: 'Builder' },
  { key: 'persona', label: 'Persona' },
  { key: 'judge', label: 'Judge' },
  { key: 'scheduled', label: 'Scheduled' },
];

/**
 * The governor's numbers, on screen (UX spec §6 Settings, brief §3).
 *
 * These are the numbers that decide how much of Alex's own Claude allocation the
 * factory may spend (principle 9), and they were editable only by hand-editing
 * `daemon-config.json` — exactly the load-bearing-configuration-with-no-control
 * the brief forbids. The Runs surface shows the live gauge; this is where it is
 * *tuned*, which is what Settings is for (§8.2: settings tune, they don't
 * reveal).
 *
 * A save takes effect immediately: the daemon memoizes its config on the file's
 * mtime, so the very next governor decision re-reads it. No restart, no signal.
 */

/** The daemon's own formula (`engine/quota-governor.ts` reserveFloor). */
export function reserveFloorOf(maxSessionsPerWindow: number, reservePercent: number): number {
  if (maxSessionsPerWindow <= 0) return 0;
  const pct = Math.min(100, Math.max(0, reservePercent));
  const floor = Math.floor(maxSessionsPerWindow * (1 - pct / 100));
  // A 100% reserve is an explicit "no autonomy"; anything less leaves one spawn.
  return floor > 0 || pct >= 100 ? floor : 1;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function GovernorCard() {
  const { config, status, updateConfig } = useDaemon();
  const governor = config.execution.governor;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [windowHours, setWindowHours] = useState(5);
  const [maxSessions, setMaxSessions] = useState(40);
  const [reservePercent, setReservePercent] = useState(20);
  const [enabled, setEnabled] = useState(true);
  const [roleRouting, setRoleRouting] = useState<
    Record<'builder' | 'persona' | 'judge' | 'scheduled', Backend>
  >({
    builder: 'claude',
    persona: 'claude',
    judge: 'claude',
    scheduled: 'claude',
  });

  if (!governor) return null;

  function startEditing() {
    if (!governor) return;
    setWindowHours(governor.windowHours);
    setMaxSessions(governor.maxSessionsPerWindow);
    setReservePercent(governor.reservePercent);
    setEnabled(governor.enabled);
    setRoleRouting({
      builder: governor.roleRouting.builder,
      persona: governor.roleRouting.persona,
      judge: governor.roleRouting.judge,
      // Same fallback as the daemon's own resolveRoleBackend (quota-governor.ts).
      scheduled: governor.roleRouting.scheduled ?? 'claude',
    });
    setEditing(true);
  }

  async function save() {
    if (!governor) return;
    setSaving(true);
    try {
      await updateConfig({
        execution: {
          // Spread first: this form knows about the governor block and nothing
          // else, and must not drop the fields it has never heard of.
          ...config.execution,
          // The kill switch is file/CLI-only (owner decision, UX-REBUILD-BRIEF
          // §2) and deliberately absent from this object — `...governor`
          // preserves whatever the file already has, and this form never
          // overrides it.
          governor: {
            ...governor,
            windowHours,
            maxSessionsPerWindow: maxSessions,
            reservePercent,
            enabled,
            roleRouting,
          },
        },
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const floor = reserveFloorOf(
    editing ? maxSessions : governor.maxSessionsPerWindow,
    editing ? reservePercent : governor.reservePercent,
  );
  const ceiling = editing ? maxSessions : governor.maxSessionsPerWindow;
  // The file half of the kill switch, which config cannot un-press.
  const fileKilled = (status.governor?.killSwitch ?? false) && !governor.killSwitch;

  return (
    <Card className={governor.killSwitch || fileKilled ? 'border-destructive' : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5" />
              Governor
            </CardTitle>
            <CardDescription>
              How much of your own Claude allocation the factory may spend. Changes take effect on
              the next spawn — the daemon re-reads its config when the file changes.
            </CardDescription>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startEditing}
              className="gap-1.5 text-muted-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(governor.killSwitch || fileKilled) && (
          <div className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <OctagonX className="h-4 w-4 shrink-0" />
            <span>
              {fileKilled
                ? 'Kill switch active via data/governor-kill — a file switch cannot be un-pressed from a browser.'
                : 'Kill switch active — no autonomous sessions will start.'}
            </span>
          </div>
        )}

        {editing ? (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <Field
                label="Window (hours)"
                value={windowHours}
                min={1}
                max={168}
                onChange={(v) => setWindowHours(clamp(v, 1, 168))}
              />
              <Field
                label="Window ceiling (sessions)"
                value={maxSessions}
                min={1}
                max={1000}
                onChange={(v) => setMaxSessions(clamp(v, 1, 1000))}
              />
              <Field
                label="Reserve for you (%)"
                value={reservePercent}
                min={0}
                max={100}
                onChange={(v) => setReservePercent(clamp(v, 0, 100))}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Governor enabled — gate autonomous spawns against the quota window above
            </label>

            <p className="text-xs text-muted-foreground">
              Agents stop at <span className="font-medium text-foreground">{floor}</span> sessions;
              the {ceiling - floor} above that are kept for you.
            </p>

            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-medium">Backend routing</p>
              <p className="text-xs text-muted-foreground">
                Which backend each spawn role runs on.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ROLES.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <Select
                      value={roleRouting[key]}
                      onValueChange={(v) =>
                        setRoleRouting((prev) => ({ ...prev, [key]: v as Backend }))
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="claude">Claude</SelectItem>
                        <SelectItem value="codex">Codex</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void save()}>
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => setEditing(false)}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Fact label="Window" value={`${governor.windowHours}h`} />
            <Fact label="Ceiling" value={`${governor.maxSessionsPerWindow} sessions`} />
            <Fact label="Reserve" value={`${governor.reservePercent}% — floor at ${floor}`} />
            <Fact label="Gating" value={governor.enabled ? 'on' : 'off'} />
            <Fact
              label="Routing"
              value={ROLES.map(
                ({ key, label }) => `${label}→${governor.roleRouting[key] ?? 'claude'}`,
              ).join(', ')}
            />
            {governor.killSwitch && (
              <Badge variant="outline" className="border-destructive/60 text-destructive">
                kill switch on
              </Badge>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A stop a browser can reach is a stop an agent can un-press — so the kill switch lives only
          in the file and CLI: <code className="font-mono">touch data/governor-kill</code>.
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="h-8"
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

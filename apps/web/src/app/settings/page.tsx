'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ErrorState } from '@/components/error-state';
import { GovernorCard } from '@/components/governor-card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDaemon } from '@/hooks/use-daemon';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import {
  AlertTriangle,
  Database,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Timer,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AboutCard } from './about-card';
import { AgentsCard } from './agents-card';
import { HarnessCard } from './harness-card';
import { MemoryCard } from './memory-card';
import { ModelsCard } from './models-card';
import { NotificationsCard } from './notifications-card';
import { ProjectLocationsCard } from './project-locations-card';

/**
 * Settings tunes the daemon; it never hides it. Autopilot's live state — quota,
 * preflight, streams, history — stays on Runs, per seam rule §8.2 ("nothing
 * load-bearing hides in Settings").
 */

const FREQUENCY_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every day at 7:00 AM', cron: '0 7 * * *' },
  { label: 'Every day at 9:00 AM', cron: '0 9 * * *' },
  { label: 'Every day at noon', cron: '0 12 * * *' },
  { label: 'Every day at 5:00 PM', cron: '0 17 * * *' },
  { label: 'Every day at 9:00 PM', cron: '0 21 * * *' },
  { label: 'Weekdays at 7:00 AM', cron: '0 7 * * 1-5' },
  { label: 'Weekdays at 9:00 AM', cron: '0 9 * * 1-5' },
  { label: 'Weekdays at noon', cron: '0 12 * * 1-5' },
  { label: 'Weekdays at 5:00 PM', cron: '0 17 * * 1-5' },
  { label: 'Mondays at 9:00 AM', cron: '0 9 * * 1' },
  { label: 'Fridays at 5:00 PM', cron: '0 17 * * 5' },
  { label: 'Sundays at 7:00 PM', cron: '0 19 * * 0' },
];

const AVAILABLE_COMMANDS = [
  'standup',
  'daily-plan',
  'weekly-review',
  'brainstorm',
  'research',
  'plan-feature',
  'ship-feature',
  'pick-up-work',
  'report',
  'orchestrate',
];

function cronToHuman(cron: string): string {
  const preset = FREQUENCY_PRESETS.find((p) => p.cron === cron);
  return preset ? preset.label : cron;
}

/** Blank means "the daemon's default" (auto-detect on PATH), never an empty string. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeBackendMode(value: unknown): 'claude' | 'mixed' | 'codex' | 'gemini' {
  if (value === 'claude' || value === 'mixed' || value === 'codex' || value === 'gemini')
    return value;
  return 'claude';
}

function normalizeFailoverBackend(value: unknown): 'codex' | 'gemini' | 'none' {
  if (value === 'codex' || value === 'gemini') return value;
  return 'none';
}

/** Add/remove tag list, same interaction as library/new/page.tsx's tag editor. */
function TagListEditor({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  function add() {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput('');
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="gap-1 pr-1 text-xs">
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoDataCard() {
  const [seeding, setSeeding] = useState(false);

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      const res = await apiFetch('/api/seed-demo', { method: 'POST' });
      if (res.ok) {
        toast.success('Demo data loaded! Refreshing...');
        setTimeout(() => window.location.reload(), 500);
      } else {
        toast.error('Failed to load demo data');
      }
    } catch {
      toast.error('Failed to load demo data');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Demo data
        </CardTitle>
        <CardDescription>
          Populate the workspace with sample projects, tasks, goals and agent activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleSeedDemo}
          disabled={seeding}
        >
          <Database className="h-3.5 w-3.5" />
          {seeding ? 'Loading...' : 'Load demo data'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { status, config, isLoading, error, updateConfig } = useDaemon();

  const [editingConfig, setEditingConfig] = useState(false);
  const [maxParallelAgents, setMaxParallelAgents] = useState(1);
  const [maxTurns, setMaxTurns] = useState(10);
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [retries, setRetries] = useState(1);
  const [pollingInterval, setPollingInterval] = useState(5);
  const [backendMode, setBackendMode] = useState<'claude' | 'mixed' | 'codex' | 'gemini'>('claude');
  const [claudeAutoFailoverEnabled, setClaudeAutoFailoverEnabled] = useState(true);
  const [claudeAutoFailoverThreshold, setClaudeAutoFailoverThreshold] = useState(2);
  const [claudeAutoFailoverBackend, setClaudeAutoFailoverBackend] = useState<
    'codex' | 'gemini' | 'none'
  >('codex');
  // Per-backend binary path and model. These already existed in daemon-config
  // and were only editable by hand-editing the JSON (D7 DC-2): ligma's backends
  // are CLI-subscription by design (principle 9), so *which* binary and *which*
  // model is the whole of its provider configuration, and it belongs on screen.
  const [claudeBinaryPath, setClaudeBinaryPath] = useState('');
  const [codexBinaryPath, setCodexBinaryPath] = useState('');
  const [codexModel, setCodexModel] = useState('');
  const [geminiBinaryPath, setGeminiBinaryPath] = useState('');
  const [geminiModel, setGeminiModel] = useState('');
  // Execution/concurrency knobs that previously required hand-editing
  // data/daemon-config.json (config-surface audit).
  const [retryDelayMinutes, setRetryDelayMinutes] = useState(5);
  const [agentTeams, setAgentTeams] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [codexTaskTags, setCodexTaskTags] = useState<string[]>([]);
  const [geminiTaskTags, setGeminiTaskTags] = useState<string[]>([]);

  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [editCron, setEditCron] = useState('');
  const [editCommand, setEditCommand] = useState('');

  function startEditing() {
    setMaxParallelAgents(config.concurrency.maxParallelAgents);
    setMaxTurns(config.execution.maxTurns);
    setTimeoutMinutes(config.execution.timeoutMinutes);
    setRetries(config.execution.retries);
    setPollingInterval(config.polling.intervalMinutes);
    setBackendMode(normalizeBackendMode(config.execution.backendMode));
    setClaudeAutoFailoverEnabled(config.execution.claudeAutoFailoverEnabled ?? true);
    setClaudeAutoFailoverThreshold(config.execution.claudeAutoFailoverThreshold ?? 2);
    setClaudeAutoFailoverBackend(
      normalizeFailoverBackend(config.execution.claudeAutoFailoverBackend),
    );
    setClaudeBinaryPath(config.execution.claudeBinaryPath ?? '');
    setCodexBinaryPath(config.execution.codexBinaryPath ?? '');
    setCodexModel(config.execution.codexModel ?? '');
    setGeminiBinaryPath(config.execution.geminiBinaryPath ?? '');
    setGeminiModel(config.execution.geminiModel ?? '');
    setRetryDelayMinutes(config.execution.retryDelayMinutes);
    setAgentTeams(config.execution.agentTeams);
    setPollingEnabled(config.polling.enabled);
    setAllowedTools(config.execution.allowedTools);
    setCodexTaskTags(config.execution.codexTaskTags);
    setGeminiTaskTags(config.execution.geminiTaskTags);
    setEditingConfig(true);
  }

  async function saveConfig() {
    // Re-read right before sending: the `config` closed over here can be
    // several seconds stale, and the daemon merges `execution` field-by-field
    // against whatever it holds *now* — a stale spread would silently
    // overwrite a field the Models/Harness cards saved in the meantime (W12).
    const freshRes = await apiFetch('/api/daemon');
    const freshExecution = freshRes.ok
      ? (((await freshRes.json()) as { config?: typeof config }).config?.execution ??
        config.execution)
      : config.execution;
    await updateConfig({
      concurrency: { maxParallelAgents },
      execution: {
        // Spread first so fields this form doesn't know about (harness, governor,
        // and anything added later) round-trip instead of being dropped.
        ...freshExecution,
        maxTurns,
        timeoutMinutes,
        retries,
        retryDelayMinutes,
        agentTeams,
        allowedTools,
        backendMode: normalizeBackendMode(backendMode),
        codexTaskTags,
        geminiTaskTags,
        claudeAutoFailoverEnabled,
        claudeAutoFailoverThreshold,
        claudeAutoFailoverBackend:
          claudeAutoFailoverBackend === 'none' ? null : claudeAutoFailoverBackend,
        // Empty means "auto-detect on PATH" (`findCliBinary`), which is what
        // null already meant — so blanking the field restores the default
        // rather than pinning an empty string.
        claudeBinaryPath: blankToNull(claudeBinaryPath),
        codexBinaryPath: blankToNull(codexBinaryPath),
        codexModel: blankToNull(codexModel),
        geminiBinaryPath: blankToNull(geminiBinaryPath),
        geminiModel: blankToNull(geminiModel),
      },
      polling: { enabled: pollingEnabled, intervalMinutes: pollingInterval },
    });
    setEditingConfig(false);
  }

  async function toggleSchedule(name: string) {
    const entry = config.schedule[name];
    if (!entry) return;
    await updateConfig({
      schedule: { ...config.schedule, [name]: { ...entry, enabled: !entry.enabled } },
    });
  }

  function startEditingSchedule(name: string) {
    const entry = config.schedule[name];
    if (!entry) return;
    setEditCron(entry.cron);
    setEditCommand(entry.command);
    setEditingSchedule(name);
  }

  function cancelEditingSchedule() {
    setEditingSchedule(null);
    setEditCron('');
    setEditCommand('');
  }

  async function saveScheduleEntry(name: string) {
    await updateConfig({
      schedule: {
        ...config.schedule,
        [name]: { ...config.schedule[name], cron: editCron, command: editCommand },
      },
    });
    setEditingSchedule(null);
  }

  async function addScheduleEntry() {
    const newName = `schedule_${Date.now()}`;
    await updateConfig({
      schedule: {
        ...config.schedule,
        [newName]: { enabled: true, cron: '0 9 * * *', command: 'daily-plan' },
      },
    });
  }

  async function removeScheduleEntry(name: string) {
    const updated = { ...config.schedule };
    delete updated[name];
    await updateConfig({ schedule: updated });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Settings' }]} />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Settings' }]} />
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Settings' }]} />

      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Daemon schedule and execution config. Live autopilot status, quota and run streams live on{' '}
          <Link href="/runs" className="underline underline-offset-2">
            Runs
          </Link>
          .
        </p>
      </div>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Timer className="h-5 w-5" />
                Schedule
              </CardTitle>
              <CardDescription className="mt-1.5">
                Polling every {config.polling.intervalMinutes} minutes
                {!config.polling.enabled && ' (disabled)'}
              </CardDescription>
            </div>
            <Tip content="Add a new scheduled skill">
              <Button variant="outline" size="sm" onClick={addScheduleEntry} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </Tip>
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(config.schedule).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No scheduled skills yet. Click &ldquo;Add&rdquo; to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(config.schedule).map(([name, schedule]) => (
                <div key={name} className="rounded-lg border p-3">
                  {editingSchedule === name ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">Skill Command</p>
                          <Select value={editCommand} onValueChange={setEditCommand}>
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {AVAILABLE_COMMANDS.map((cmd) => (
                                <SelectItem key={cmd} value={cmd}>
                                  /{cmd}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">Frequency</p>
                          <Select value={editCron} onValueChange={setEditCron}>
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FREQUENCY_PRESETS.map((preset) => (
                                <SelectItem key={preset.cron} value={preset.cron}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Tip content="Discard changes">
                          <Button variant="ghost" size="sm" onClick={cancelEditingSchedule}>
                            <X className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                        </Tip>
                        <Tip content="Save schedule changes">
                          <Button size="sm" onClick={() => saveScheduleEntry(name)}>
                            <Save className="h-3.5 w-3.5 mr-1" />
                            Save
                          </Button>
                        </Tip>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggleSchedule(name)}
                          className="cursor-pointer"
                          title={schedule.enabled ? 'Click to disable' : 'Click to enable'}
                        >
                          <Badge
                            variant={schedule.enabled ? 'default' : 'outline'}
                            className="text-xs hover:opacity-80 transition-opacity"
                          >
                            {schedule.enabled ? 'ON' : 'OFF'}
                          </Badge>
                        </button>
                        <div>
                          <p className="font-medium">/{schedule.command}</p>
                          <p className="text-xs text-muted-foreground">
                            {cronToHuman(schedule.cron)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {status.nextScheduledRuns[schedule.command] && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            Next: {formatDateTime(status.nextScheduledRuns[schedule.command])}
                          </span>
                        )}
                        <Tip content="Edit schedule entry">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            aria-label="Edit schedule entry"
                            onClick={() => startEditingSchedule(name)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Tip>
                        <Tip content="Remove schedule entry">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-500"
                            aria-label="Remove schedule entry"
                            onClick={() => removeScheduleEntry(name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tip>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Governor — the numbers that ration Alex's own allocation (§6, brief §3). */}
      <GovernorCard />

      {/* Editable Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Configuration
            </CardTitle>
            {!editingConfig && (
              <Tip content="Edit configuration">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startEditing}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Tip>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Max Parallel Agents</p>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxParallelAgents}
                    onChange={(e) =>
                      setMaxParallelAgents(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Max Turns per Task</p>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={maxTurns}
                    onChange={(e) =>
                      setMaxTurns(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Timeout (minutes)</p>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={timeoutMinutes}
                    onChange={(e) =>
                      setTimeoutMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Retries</p>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={retries}
                    onChange={(e) =>
                      setRetries(Math.max(0, Math.min(5, Number(e.target.value) || 0)))
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Polling Interval (min)</p>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={pollingInterval}
                    onChange={(e) =>
                      setPollingInterval(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                    }
                    className="h-8"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Backend Mode</p>
                  <Select
                    value={backendMode}
                    onValueChange={(v) =>
                      setBackendMode(v as 'claude' | 'mixed' | 'codex' | 'gemini')
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude</SelectItem>
                      <SelectItem value="mixed">Mixed (tags)</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Claude Auto-Failover</p>
                  <Select
                    value={claudeAutoFailoverEnabled ? 'on' : 'off'}
                    onValueChange={(v) => setClaudeAutoFailoverEnabled(v === 'on')}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on">Enabled</SelectItem>
                      <SelectItem value="off">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Failover Threshold</p>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={claudeAutoFailoverThreshold}
                    onChange={(e) =>
                      setClaudeAutoFailoverThreshold(
                        Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                      )
                    }
                    className="h-8"
                    disabled={!claudeAutoFailoverEnabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Failover Backend</p>
                  <Select
                    value={claudeAutoFailoverBackend}
                    onValueChange={(v) =>
                      setClaudeAutoFailoverBackend(v as 'codex' | 'gemini' | 'none')
                    }
                    disabled={!claudeAutoFailoverEnabled}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Which CLI, and which model it runs. Ligma's backends are the
                  user's own CLI subscriptions (principle 9), so this is its
                  provider configuration — the parent's API-key panel has no
                  equivalent here because there is no key to hold (D7 DC-2). */}
              <div className="space-y-2 border-t pt-4">
                <p className="text-xs font-medium">Backend binaries &amp; models</p>
                <p className="text-muted-foreground text-xs">
                  Blank means auto-detect on <code className="font-mono">PATH</code>. Ligma runs
                  your local CLI subscriptions — there is no API key to enter.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Claude binary</p>
                    <Input
                      value={claudeBinaryPath}
                      onChange={(e) => setClaudeBinaryPath(e.target.value)}
                      placeholder="claude"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Codex binary</p>
                    <Input
                      value={codexBinaryPath}
                      onChange={(e) => setCodexBinaryPath(e.target.value)}
                      placeholder="codex"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Codex model</p>
                    <Input
                      value={codexModel}
                      onChange={(e) => setCodexModel(e.target.value)}
                      placeholder="default"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Gemini binary</p>
                    <Input
                      value={geminiBinaryPath}
                      onChange={(e) => setGeminiBinaryPath(e.target.value)}
                      placeholder="gemini"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Gemini model</p>
                    <Input
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      placeholder="default"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Execution & concurrency — previously JSON-only (config-surface audit). */}
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-medium">Execution &amp; concurrency</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Retry Delay (minutes)</p>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={retryDelayMinutes}
                      onChange={(e) =>
                        setRetryDelayMinutes(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                      }
                      className="h-8"
                    />
                  </div>
                  <label
                    htmlFor="agent-teams"
                    className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs"
                  >
                    <span>
                      Agent teams
                      <span className="block text-muted-foreground">
                        Lets a builder spawn its own sub-agents.
                      </span>
                    </span>
                    <Switch id="agent-teams" checked={agentTeams} onCheckedChange={setAgentTeams} />
                  </label>
                  <label
                    htmlFor="polling-enabled"
                    className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs"
                  >
                    <span>
                      Polling
                      <span className="block text-muted-foreground">
                        Daemon picks up work on its own schedule.
                      </span>
                    </span>
                    <Switch
                      id="polling-enabled"
                      checked={pollingEnabled}
                      onCheckedChange={setPollingEnabled}
                    />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs">Allowed tools</p>
                  <TagListEditor
                    tags={allowedTools}
                    onChange={setAllowedTools}
                    placeholder="e.g. Read"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Pre-approved for every agent via{' '}
                    <code className="font-mono">--allowedTools</code>. Removing a tool here
                    constrains every agent, not just one.
                  </p>
                </div>
              </div>

              {/* Backend tag routing — only consulted when Backend Mode above is Mixed. */}
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-medium">Backend tag routing</p>
                <p className="text-[11px] text-muted-foreground">
                  A task carrying one of these tags routes to that backend instead of Claude &mdash;
                  only takes effect when Backend Mode above is <strong>Mixed</strong>.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Codex task tags</p>
                    <TagListEditor
                      tags={codexTaskTags}
                      onChange={setCodexTaskTags}
                      placeholder="e.g. codex"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">Gemini task tags</p>
                    <TagListEditor
                      tags={geminiTaskTags}
                      onChange={setGeminiTaskTags}
                      placeholder="e.g. gemini"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Tip content="Discard changes">
                  <Button variant="ghost" size="sm" onClick={() => setEditingConfig(false)}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                </Tip>
                <Tip content="Save configuration changes">
                  <Button size="sm" onClick={saveConfig}>
                    <Save className="h-3.5 w-3.5 mr-1" />
                    Save
                  </Button>
                </Tip>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Max Parallel Agents</p>
                <p className="font-bold">{config.concurrency.maxParallelAgents}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Max Turns per Task</p>
                <p className="font-bold">{config.execution.maxTurns}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Timeout</p>
                <p className="font-bold">{config.execution.timeoutMinutes} min</p>
              </div>
              <div>
                <p className="text-muted-foreground">Retries</p>
                <p className="font-bold">{config.execution.retries}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Polling Interval</p>
                <p className="font-bold">
                  {config.polling.intervalMinutes} min{!config.polling.enabled && ' (disabled)'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Backend Mode</p>
                <p className="font-bold capitalize">
                  {normalizeBackendMode(config.execution.backendMode)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Claude Auto-Failover</p>
                <p className="font-bold">
                  {(config.execution.claudeAutoFailoverEnabled ?? true)
                    ? `${config.execution.claudeAutoFailoverThreshold ?? 2} -> ${normalizeFailoverBackend(config.execution.claudeAutoFailoverBackend)}`
                    : 'Disabled'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Retry Delay</p>
                <p className="font-bold">{config.execution.retryDelayMinutes} min</p>
              </div>
              <div>
                <p className="text-muted-foreground">Agent Teams</p>
                <p className="font-bold">{config.execution.agentTeams ? 'On' : 'Off'}</p>
              </div>
            </div>
          )}
          {config.execution.skipPermissions && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
              <span>
                <strong>skipPermissions</strong> is enabled &mdash; Claude Code bypasses all
                permission prompts
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground underline decoration-dotted cursor-help ml-auto shrink-0">
                    Why can&apos;t I edit this?
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  <p className="text-xs">
                    For safety, skipPermissions can only be changed by editing{' '}
                    <code className="text-[10px]">data/daemon-config.json</code> directly.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          {!editingConfig &&
            config.execution.allowedTools.length > 0 &&
            !config.execution.skipPermissions && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
                <Zap className="h-4 w-4 text-blue-500 shrink-0" />
                <span>
                  <strong>Allowed tools:</strong>{' '}
                  {config.execution.allowedTools.map((tool) => (
                    <Badge key={tool} variant="outline" className="text-xs mr-1">
                      {tool}
                    </Badge>
                  ))}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground underline decoration-dotted cursor-help ml-auto shrink-0">
                      What is this?
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px]">
                    <p className="text-xs">
                      These tools are pre-approved for agents via{' '}
                      <code className="text-[10px]">--allowedTools</code>. Click Edit above to
                      change.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
        </CardContent>
      </Card>

      <ProjectLocationsCard />

      <NotificationsCard />
      <AgentsCard />
      <MemoryCard />
      <ModelsCard />
      <HarnessCard />
      <p className="text-sm text-muted-foreground">
        <Link className="underline underline-offset-4" href="/settings/integrations">
          Integrations — MCP servers and agent handoff
        </Link>
      </p>

      <DemoDataCard />

      <AboutCard />
    </div>
  );
}

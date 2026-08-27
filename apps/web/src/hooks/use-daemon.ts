'use client';

import { useSmartPoll } from '@/hooks/use-smart-poll';
import { apiFetch } from '@/lib/api-client';
import { useCallback, useState } from 'react';

interface AgentSession {
  id: string;
  agentId: string;
  taskId: string | null;
  command: string;
  pid: number;
  startedAt: string;
  status: string;
}

interface SessionHistoryEntry extends AgentSession {
  completedAt: string;
  exitCode: number | null;
  error: string | null;
  durationMinutes: number;
}

interface DaemonStats {
  tasksDispatched: number;
  tasksCompleted: number;
  tasksFailed: number;
  uptimeMinutes: number;
}

export interface GovernorStatus {
  enabled: boolean;
  windowHours: number;
  used: number;
  max: number;
  /** Autonomy stops here; the gap up to `max` is the human's reserve. */
  reserveFloor: number;
  remainingForAutonomy: number;
  backends: Record<string, { state: 'ready' | 'cooling'; coolingUntil: string | null }>;
  killSwitch: boolean;
}

interface DaemonStatus {
  status: 'running' | 'stopped' | 'starting';
  pid: number | null;
  startedAt: string | null;
  activeSessions: AgentSession[];
  history: SessionHistoryEntry[];
  stats: DaemonStats;
  lastPollAt: string | null;
  nextScheduledRuns: Record<string, string>;
  /** Written by the daemon; absent when the status file predates the governor. */
  governor?: GovernorStatus;
}

interface DaemonConfig {
  polling: { enabled: boolean; intervalMinutes: number };
  concurrency: { maxParallelAgents: number };
  schedule: Record<string, { enabled: boolean; cron: string; command: string }>;
  execution: {
    maxTurns: number;
    timeoutMinutes: number;
    retries: number;
    retryDelayMinutes: number;
    skipPermissions: boolean;
    allowedTools: string[];
    agentTeams: boolean;
    claudeBinaryPath: string | null;
    backendMode: 'claude' | 'mixed' | 'codex' | 'gemini';
    codexTaskTags: string[];
    codexBinaryPath: string | null;
    codexModel: string | null;
    geminiTaskTags: string[];
    geminiBinaryPath: string | null;
    geminiModel: string | null;
    claudeAutoFailoverEnabled: boolean;
    claudeAutoFailoverThreshold: number;
    claudeAutoFailoverBackend: 'codex' | 'gemini' | null;
    /** Acceptance-harness settings. Optional: older status snapshots predate it. */
    harness?: {
      autoVerify: boolean;
      maxParallelPersonas: number;
      naiveUserRuns: number;
      judgeModel: string | null;
    };
    /** Quota governor settings. Optional: older status snapshots predate it. */
    governor?: {
      enabled: boolean;
      windowHours: number;
      maxSessionsPerWindow: number;
      reservePercent: number;
      killSwitch: boolean;
      roleRouting: {
        builder: 'claude' | 'codex' | 'gemini';
        persona: 'claude' | 'codex' | 'gemini';
        judge: 'claude' | 'codex' | 'gemini';
        scheduled?: 'claude' | 'codex' | 'gemini';
      };
    };
  };
  /** OD-097 product-repo root override. Optional: older config files predate it. */
  storage?: {
    productsDir: string | null;
  };
  /** OD-096 desktop-notification toggle. Optional: older config files predate it. */
  notifications?: {
    desktopEnabled: boolean;
  };
}

interface DaemonData {
  status: DaemonStatus;
  config: DaemonConfig;
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  updateConfig: (updates: Partial<DaemonConfig>) => Promise<void>;
  refetch: () => Promise<void>;
}

const POLL_INTERVAL = 5000; // 5 seconds

export function useDaemon(): DaemonData {
  const [status, setStatus] = useState<DaemonStatus>({
    status: 'stopped',
    pid: null,
    startedAt: null,
    activeSessions: [],
    history: [],
    stats: { tasksDispatched: 0, tasksCompleted: 0, tasksFailed: 0, uptimeMinutes: 0 },
    lastPollAt: null,
    nextScheduledRuns: {},
  });
  const [config, setConfig] = useState<DaemonConfig>({
    polling: { enabled: true, intervalMinutes: 5 },
    concurrency: { maxParallelAgents: 3 },
    schedule: {},
    execution: {
      maxTurns: 25,
      timeoutMinutes: 30,
      retries: 1,
      retryDelayMinutes: 5,
      skipPermissions: false,
      allowedTools: ['Read', 'Edit', 'Write'],
      agentTeams: false,
      claudeBinaryPath: null,
      backendMode: 'claude',
      codexTaskTags: ['codex'],
      codexBinaryPath: null,
      codexModel: null,
      geminiTaskTags: ['gemini'],
      geminiBinaryPath: null,
      geminiModel: null,
      claudeAutoFailoverEnabled: true,
      claudeAutoFailoverThreshold: 2,
      claudeAutoFailoverBackend: 'codex',
    },
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon');
      if (!res.ok) throw new Error('Failed to fetch daemon status');
      const data = await res.json();
      setStatus(data.status);
      setConfig(data.config);
      setIsRunning(data.isRunning);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useSmartPoll(refetch, { intervalMs: POLL_INTERVAL });

  const start = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start daemon');
      }
      // Refetch after a short delay to pick up the new status
      setTimeout(refetch, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start daemon');
    }
  }, [refetch]);

  const stop = useCallback(async () => {
    try {
      const res = await apiFetch('/api/daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to stop daemon');
      }
      setTimeout(refetch, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop daemon');
    }
  }, [refetch]);

  const updateConfig = useCallback(
    async (updates: Partial<DaemonConfig>) => {
      try {
        const res = await apiFetch('/api/daemon', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error('Failed to update config');
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update config');
      }
    },
    [refetch],
  );

  return { status, config, isRunning, isLoading, error, start, stop, updateConfig, refetch };
}

'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { showError, showSuccess } from '@/lib/toast';
import {
  Download,
  FileJson,
  Flag,
  FolderOpen,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CheckpointMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  version: number;
  stats: {
    tasks: number;
    projects: number;
    goals: number;
    brainDump: number;
    inbox: number;
    decisions: number;
    agents: number;
    skills: number;
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CheckpointsPage() {
  const router = useRouter();
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Dialog states
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState<CheckpointMeta | null>(null);
  const [showDelete, setShowDelete] = useState<CheckpointMeta | null>(null);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);

  // Save form
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');

  // Import file ref
  const importRef = useRef<HTMLInputElement>(null);

  // ─── Fetch checkpoints ────────────────────────────────────────────────────

  const fetchCheckpoints = useCallback(async () => {
    try {
      const res = await apiFetch('/api/checkpoints');
      if (res.ok) {
        const data = await res.json();
        setCheckpoints(data);
      }
    } catch {
      showError('Failed to fetch checkpoints');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCheckpoints();
  }, [fetchCheckpoints]);

  // ─── Save current ────────────────────────────────────────────────────────

  async function handleSave() {
    if (!saveName.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/checkpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), description: saveDesc.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      showSuccess(`Checkpoint "${saveName.trim()}" saved`);
      setShowSave(false);
      setSaveName('');
      setSaveDesc('');
      fetchCheckpoints();
    } catch (err) {
      showError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Load checkpoint ──────────────────────────────────────────────────────

  async function handleLoad() {
    if (!showLoad) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/checkpoints/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: showLoad.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Load failed');
      }
      showSuccess(`Loaded "${showLoad.name}"`);
      setShowLoad(null);
      router.push('/');
    } catch (err) {
      showError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── New workspace ───────────────────────────────────────────────────────

  async function handleNewWorkspace() {
    setBusy(true);
    try {
      // Confirmation is now required server-side (P2 hardening): the route
      // wipes the whole workspace and refuses a bare POST. It also takes an
      // automatic pre-wipe checkpoint now, so a wipe is never unrecoverable.
      const res = await apiFetch('/api/checkpoints/new', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create workspace');
      }
      const result = (await res.json()) as { checkpointId?: string };
      showSuccess(
        result.checkpointId
          ? 'Fresh workspace created — your previous state was saved as a checkpoint'
          : 'Fresh workspace created',
      );
      setShowNewWorkspace(false);
      router.push('/');
    } catch (err) {
      showError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Delete checkpoint ────────────────────────────────────────────────────

  async function handleDelete() {
    if (!showDelete) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/checkpoints?id=${showDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Delete failed');
      }
      showSuccess(`Deleted "${showDelete.name}"`);
      setShowDelete(null);
      fetchCheckpoints();
    } catch (err) {
      showError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Export checkpoint ────────────────────────────────────────────────────

  function handleExport(cp: CheckpointMeta) {
    const safeName = cp.name
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    const filename = `${safeName || cp.id}.json`;
    const link = document.createElement('a');
    link.href = `/api/checkpoints/export?id=${cp.id}`;
    link.download = filename;
    link.click();
  }

  // ─── Import checkpoint ────────────────────────────────────────────────────

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await apiFetch('/api/checkpoints/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }
      const result = await res.json();
      showSuccess(`Imported "${result.name}"`);
      fetchCheckpoints();
    } catch (err) {
      showError(`Import failed: ${err}`);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <BreadcrumbNav items={[{ label: 'Checkpoints' }]} />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Checkpoints</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Save and restore your workspace state. Share checkpoints with others or start fresh.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8"
            onClick={() => setShowNewWorkspace(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New Workspace
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8"
            onClick={() => importRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            size="sm"
            className="gap-1.5 h-8"
            onClick={() => {
              setSaveName('');
              setSaveDesc('');
              setShowSave(true);
            }}
          >
            <Save className="h-3.5 w-3.5" /> Save Current
          </Button>
        </div>
      </div>

      {/* Checkpoint list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : checkpoints.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No checkpoints yet"
          description="Save your current workspace to create your first checkpoint"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {checkpoints.map((cp) => (
            <div key={cp.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileJson className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="font-semibold text-sm truncate">{cp.name}</h3>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateTime(cp.createdAt)}
                </span>
              </div>

              {cp.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{cp.description}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {cp.stats.tasks > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {cp.stats.tasks} tasks
                  </Badge>
                )}
                {cp.stats.projects > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {cp.stats.projects} projects
                  </Badge>
                )}
                {cp.stats.goals > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {cp.stats.goals} goals
                  </Badge>
                )}
                {cp.stats.agents > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {cp.stats.agents} agents
                  </Badge>
                )}
                {cp.stats.brainDump > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {cp.stats.brainDump} ideas
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1.5 pt-1 border-t">
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1.5 h-7 text-xs flex-1"
                  onClick={() => setShowLoad(cp)}
                >
                  <FolderOpen className="h-3 w-3" /> Load
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs"
                  onClick={() => handleExport(cp)}
                >
                  <Download className="h-3 w-3" /> Export
                </Button>
                <Tip content="Delete checkpoint">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive"
                    aria-label="Delete checkpoint"
                    onClick={() => setShowDelete(cp)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </Tip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Save Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showSave} onOpenChange={setShowSave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Checkpoint</DialogTitle>
            <DialogDescription>
              Save a copy of your current workspace that you can restore later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium" htmlFor="cp-name">
                Name
              </label>
              <Input
                id="cp-name"
                placeholder="e.g. Brewster Research Phase"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="cp-desc">
                Description (optional)
              </label>
              <Textarea
                id="cp-desc"
                placeholder="What state is this workspace in?"
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                maxLength={1000}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSave(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!saveName.trim() || busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Checkpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Load Confirmation ────────────────────────────────────────────── */}
      <Dialog open={!!showLoad} onOpenChange={(open) => !open && setShowLoad(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Checkpoint</DialogTitle>
            <DialogDescription>
              This replaces tasks, goals, projects, brain dump, inbox, decisions, agents, and skills
              with &ldquo;{showLoad?.name}&rdquo;. It does not touch the activity log, run history,
              or your other checkpoints. Save your current workspace first if you want to keep it.
              Refused while the engine is running.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoad(null)}>
              Cancel
            </Button>
            <Button onClick={handleLoad} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <FolderOpen className="h-4 w-4 mr-2" />
              )}
              Load Checkpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation ──────────────────────────────────────────── */}
      <Dialog open={!!showDelete} onOpenChange={(open) => !open && setShowDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Checkpoint</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{showDelete?.name}&rdquo;? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── New Workspace Confirmation ───────────────────────────────────── */}
      <Dialog open={showNewWorkspace} onOpenChange={setShowNewWorkspace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>
              This will clear all current data and start with a fresh empty workspace. Your current
              state is saved as a checkpoint automatically first, so it&apos;s always recoverable
              from here — but naming your own checkpoint first still makes it easier to find later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWorkspace(false)}>
              Cancel
            </Button>
            <Button onClick={handleNewWorkspace} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Fresh Workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

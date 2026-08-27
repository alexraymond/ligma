'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CreateTaskDialog } from '@/components/create-task-dialog';
import { ErrorState } from '@/components/error-state';
import { EntryRowSkeleton } from '@/components/skeletons';
import type { TaskFormData } from '@/components/task-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { useBrainDump, useGoals, useProjects, useTasks } from '@/hooks/use-data';
import { useProcessingEntries } from '@/hooks/use-processing-entries';
import { apiFetch } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/time';
import type { BrainDumpEntry } from '@ligma/api';
import { Archive, ArrowRight, Lightbulb, Loader2, Pencil, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function BrainDumpPage() {
  const {
    entries,
    create: createEntry,
    update: updateEntry,
    remove: deleteEntry,
    loading,
    error: dumpError,
    refetch,
  } = useBrainDump();
  const { create: createTask } = useTasks();
  const { projects } = useProjects();
  const { goals } = useGoals();
  const [newContent, setNewContent] = useState('');
  const [convertingEntry, setConvertingEntry] = useState<BrainDumpEntry | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const processing = useProcessingEntries(entries);

  function startEditing(entry: BrainDumpEntry) {
    setEditingEntryId(entry.id);
    setEditContent(entry.content);
  }

  function cancelEditing() {
    setEditingEntryId(null);
    setEditContent('');
  }

  async function handleSaveEdit() {
    if (!editingEntryId || !editContent.trim()) return;
    await updateEntry(editingEntryId, { content: editContent.trim() });
    setEditingEntryId(null);
    setEditContent('');
  }

  async function handleAutoProcessEntry(entryId: string) {
    try {
      const res = await apiFetch('/api/brain-dump/automate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryIds: [entryId] }),
      });
      if (res.ok) {
        processing.markProcessing(entryId);
      }
    } catch {
      // Network error — don't mark as processing
    }
  }

  async function handleAutoProcessAll() {
    try {
      const res = await apiFetch('/api/brain-dump/automate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const data: { entryIds: string[] } = await res.json();
        processing.markAllProcessing(data.entryIds);
      }
    } catch {
      // Network error
    }
  }

  // Poll for brain dump updates while entries are being auto-processed
  useEffect(() => {
    if (!processing.hasProcessing) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refetch();
    }, 5_000);
    return () => clearInterval(interval);
  }, [processing.hasProcessing, refetch]);

  async function handleAdd() {
    const content = newContent.trim();
    if (!content) return;
    // No client-generated id (W25): the daemon always assigns its own
    // (`generateId("bd")`, apps/daemon/src/routes/brain-dump/route.ts).
    await createEntry({
      content,
      capturedAt: new Date().toISOString(),
      processed: false,
      convertedTo: null,
      tags: [],
    });
    setNewContent('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }

  async function handleConvertToTask(data: TaskFormData) {
    if (!convertingEntry) return;
    // No client-generated id (W25): the daemon always assigns its own.
    await createTask({
      ...data,
      dailyActions: [],
      tags: data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      acceptanceCriteria: data.acceptanceCriteria
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
    await updateEntry(convertingEntry.id, { processed: true, convertedTo: 'task' });
    setConvertingEntry(null);
  }

  const unprocessed = entries.filter((e) => !e.processed);
  const processed = entries.filter((e) => e.processed);

  if (loading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Brain Dump' }]} />
        <div className="space-y-2">
          <EntryRowSkeleton />
          <EntryRowSkeleton />
          <EntryRowSkeleton />
        </div>
      </div>
    );
  }

  if (dumpError) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Brain Dump' }]} />
        <ErrorState message={dumpError} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Brain Dump' }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          Brain Dump
        </h1>
        {unprocessed.length > 0 && (
          <Tip content="Automatically process all entries">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleAutoProcessAll}
              disabled={processing.hasProcessing}
            >
              {processing.hasProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {processing.hasProcessing
                ? `Processing ${processing.processingCount}...`
                : 'Auto-Process All'}
            </Button>
          </Tip>
        )}
      </div>

      {/* Quick Capture */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Textarea
              placeholder="What's on your mind? Press Enter to capture..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[60px] flex-1 resize-none"
            />
            <Tip content="Save brain dump entry">
              <Button onClick={handleAdd} className="self-end" disabled={!newContent.trim()}>
                Capture
              </Button>
            </Tip>
          </div>
        </CardContent>
      </Card>

      {/* Unprocessed */}
      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">
          To Process ({unprocessed.length})
        </h2>
        {unprocessed.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              All caught up! Use the command bar or the form above to capture new ideas.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {unprocessed.map((entry) => (
              <Card
                key={entry.id}
                className={`bg-card/50 ${processing.isProcessing(entry.id) ? 'animate-pulse border-primary/30 bg-primary/5' : ''}`}
              >
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  {editingEntryId === entry.id ? (
                    <div className="flex-1 min-w-0 space-y-2">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[60px] text-sm resize-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSaveEdit();
                          }
                          if (e.key === 'Escape') cancelEditing();
                        }}
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={!editContent.trim()}
                          className="h-7 text-xs"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditing}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{entry.content}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(entry.capturedAt)}
                          </span>
                          {entry.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs h-4 px-1">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Tip content="Auto-process this entry">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAutoProcessEntry(entry.id)}
                            disabled={processing.isProcessing(entry.id)}
                            className="h-7 w-7 p-0 text-primary hover:text-primary"
                            aria-label="Auto-process"
                          >
                            {processing.isProcessing(entry.id) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Zap className="h-3 w-3" />
                            )}
                          </Button>
                        </Tip>
                        <Tip content="Edit entry">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing(entry)}
                            className="h-7 w-7 p-0"
                            aria-label="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </Tip>
                        <Tip content="Convert to a new task">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConvertingEntry(entry)}
                            className="h-7 gap-1 px-2 text-xs"
                          >
                            <ArrowRight className="h-3 w-3" /> Task
                          </Button>
                        </Tip>
                        <Tip content="Archive entry">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateEntry(entry.id, { processed: true })}
                            className="h-7 w-7 p-0"
                            aria-label="Archive"
                          >
                            <Archive className="h-3 w-3" />
                          </Button>
                        </Tip>
                        <Tip content="Delete entry">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeletingEntryId(entry.id)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </Tip>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Archived */}
      {processed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground/60">
            Archived ({processed.length})
          </h2>
          <div className="space-y-1.5">
            {processed.map((entry) => (
              <Card key={entry.id} className="bg-card/30 opacity-60">
                <CardContent className="p-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs line-through">{entry.content}</p>
                    {entry.convertedTo && (
                      <span className="text-xs text-muted-foreground">
                        &rarr; {entry.convertedTo}
                      </span>
                    )}
                  </div>
                  <Tip content="Delete entry">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => setDeletingEntryId(entry.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </Tip>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Convert to Task dialog */}
      <CreateTaskDialog
        open={!!convertingEntry}
        onOpenChange={(open) => {
          if (!open) setConvertingEntry(null);
        }}
        projects={projects}
        goals={goals}
        onSubmit={handleConvertToTask}
        defaultValues={
          convertingEntry
            ? { title: convertingEntry.content, tags: convertingEntry.tags.join(', ') }
            : undefined
        }
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deletingEntryId}
        onOpenChange={(open) => {
          if (!open) setDeletingEntryId(null);
        }}
        title="Delete entry?"
        description="This will permanently remove this brain dump entry. This action cannot be undone."
        onConfirm={() => {
          if (deletingEntryId) deleteEntry(deletingEntryId);
        }}
      />
    </div>
  );
}

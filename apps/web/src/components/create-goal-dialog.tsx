'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Goal, GoalType, Project } from '@ligma/api';
import { useState } from 'react';

interface CreateGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  goals: Goal[];
  onSubmit: (data: {
    title: string;
    type: GoalType;
    timeframe: string;
    projectId: string | null;
    parentGoalId: string | null;
  }) => void;
}

export function CreateGoalDialog({
  open,
  onOpenChange,
  projects,
  goals,
  onSubmit,
}: CreateGoalDialogProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<GoalType>('long-term');
  const [timeframe, setTimeframe] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [parentGoalId, setParentGoalId] = useState<string | null>(null);

  const longTermGoals = goals.filter((g) => g.type === 'long-term');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      type,
      timeframe,
      projectId,
      parentGoalId: type === 'medium-term' ? parentGoalId : null,
    });
    setTitle('');
    setType('long-term');
    setTimeframe('');
    setProjectId(null);
    setParentGoalId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Objective</DialogTitle>
          <DialogDescription>Define a new objective or milestone.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-title">Title</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Objective title"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as GoalType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long-term">Long-Term Objective</SelectItem>
                  <SelectItem value="medium-term">Milestone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-timeframe">Timeframe</Label>
              <Input
                id="goal-timeframe"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                placeholder="e.g., Q1 2026"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Project</Label>
            <Select
              value={projectId ?? 'none'}
              onValueChange={(v) => setProjectId(v === 'none' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'medium-term' && (
            <div className="space-y-2">
              <Label>Parent Objective</Label>
              <Select
                value={parentGoalId ?? 'none'}
                onValueChange={(v) => setParentGoalId(v === 'none' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Parent Objective</SelectItem>
                  {longTermGoals.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create Objective
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

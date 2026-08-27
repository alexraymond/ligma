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
import type { Goal, GoalStatus, GoalType, Project } from '@ligma/api';
import { useEffect, useState } from 'react';

interface EditGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal;
  projects: Project[];
  goals: Goal[];
  onSubmit: (data: {
    title: string;
    type: GoalType;
    timeframe: string;
    status: GoalStatus;
    projectId: string | null;
    parentGoalId: string | null;
  }) => void;
}

export function EditGoalDialog({
  open,
  onOpenChange,
  goal,
  projects,
  goals,
  onSubmit,
}: EditGoalDialogProps) {
  const [title, setTitle] = useState(goal.title);
  const [type, setType] = useState<GoalType>(goal.type);
  const [timeframe, setTimeframe] = useState(goal.timeframe);
  const [status, setStatus] = useState<GoalStatus>(goal.status);
  const [projectId, setProjectId] = useState<string | null>(goal.projectId);
  const [parentGoalId, setParentGoalId] = useState<string | null>(goal.parentGoalId);

  // Reset form when goal changes
  useEffect(() => {
    setTitle(goal.title);
    setType(goal.type);
    setTimeframe(goal.timeframe);
    setStatus(goal.status);
    setProjectId(goal.projectId);
    setParentGoalId(goal.parentGoalId);
  }, [goal]);

  const longTermGoals = goals.filter((g) => g.type === 'long-term' && g.id !== goal.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      type,
      timeframe,
      status,
      projectId,
      parentGoalId: type === 'medium-term' ? parentGoalId : null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Objective</DialogTitle>
          <DialogDescription>Update objective details and status.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-goal-title">Title</Label>
            <Input
              id="edit-goal-title"
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
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as GoalStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not-started">Not Started</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-goal-timeframe">Timeframe</Label>
            <Input
              id="edit-goal-timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              placeholder="e.g., Q1 2026"
            />
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
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

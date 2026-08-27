'use client';

import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import { getAgentIcon } from '@/lib/agent-icons';
import type { AgentDefinition, Project, ProjectStatus } from '@ligma/api';
import { Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const PROJECT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
];

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  agents: AgentDefinition[];
  onSubmit: (data: {
    name: string;
    description: string;
    status: ProjectStatus;
    color: string;
    teamMembers: string[];
    tags: string[];
  }) => void;
}

export function EditProjectDialog({
  open,
  onOpenChange,
  project,
  agents,
  onSubmit,
}: EditProjectDialogProps) {
  const activeAgents = agents.filter((a) => a.status === 'active');

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [color, setColor] = useState(project.color);
  const [tags, setTags] = useState(project.tags.join(', '));
  const [teamMembers, setTeamMembers] = useState<string[]>(project.teamMembers);

  // Reset form when project changes
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setStatus(project.status);
    setColor(project.color);
    setTags(project.tags.join(', '));
    setTeamMembers([...project.teamMembers]);
  }, [project]);

  const toggleTeamMember = (agentId: string) => {
    setTeamMembers((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description,
      status,
      color,
      teamMembers,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>Update project details and crew.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-proj-name">Name</Label>
            <Input
              id="edit-proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-proj-desc">Description</Label>
            <Textarea
              id="edit-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              {/* True semantic (fixed in 5e607ec): pausing only gates new
                  dispatch — it does not touch sessions already running. */}
              {status === 'paused' && (
                <p className="text-xs text-muted-foreground">
                  Nothing new starts — running agents finish; pending tasks and due retries stay
                  queued.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-1.5 pt-1">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-6 w-6 rounded-full border-2 transition-transform ${
                      color === c
                        ? 'scale-110 border-foreground'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Crew Members */}
          {activeAgents.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Crew Members
                {teamMembers.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    {teamMembers.length} selected
                  </span>
                )}
              </Label>
              {/* Selected members */}
              {teamMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {teamMembers.map((memberId) => {
                    const agent = activeAgents.find((a) => a.id === memberId);
                    const MemberIcon = getAgentIcon(memberId, agent?.icon);
                    return (
                      <Badge key={memberId} variant="secondary" className="gap-1 pr-1 text-xs">
                        <MemberIcon className="h-3 w-3" />
                        {agent?.name ?? memberId}
                        <button
                          type="button"
                          onClick={() => toggleTeamMember(memberId)}
                          className="rounded-full hover:bg-muted-foreground/20 p-0.5 ml-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
              {/* Available agents */}
              <div className="flex flex-wrap gap-1.5">
                {activeAgents
                  .filter((a) => !teamMembers.includes(a.id))
                  .map((agent) => {
                    const AgentIcon = getAgentIcon(agent.id, agent.icon);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => toggleTeamMember(agent.id)}
                        className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <AgentIcon className="h-3 w-3" />
                        {agent.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-proj-tags">Tags (comma-separated)</Label>
            <Input
              id="edit-proj-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="saas, web, mobile..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

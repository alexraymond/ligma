'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { useAgents, useSkills } from '@/hooks/use-data';
import { ArrowLeft, Plus, Save, Tag, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewSkillPage() {
  const router = useRouter();
  const { create: createSkill } = useSkills();
  const { agents } = useAgents();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setSaving(true);
    try {
      await createSkill({
        id: `skill_${Date.now()}`,
        name,
        description,
        content,
        agentIds,
        tags,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      router.push('/library');
    } catch {
      setError('Failed to create skill.');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const toggleAgent = (agentId: string) => {
    setAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <BreadcrumbNav items={[{ label: 'Library', href: '/library' }, { label: 'New Skill' }]} />

      <div className="flex items-center gap-3">
        <Tip content="Back">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tip>
        <h1 className="text-xl font-bold">Create New Skill</h1>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="skill-name">Name *</Label>
          <Input
            id="skill-name"
            placeholder="e.g. Web Research"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="skill-desc">Description</Label>
          <Input
            id="skill-desc"
            placeholder="Brief description of what this skill does"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="skill-content">Content (Markdown)</Label>
          <Textarea
            id="skill-content"
            placeholder="Full skill content in Markdown. This gets injected into agent system prompts when the skill is assigned."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {content.length.toLocaleString()} characters
          </p>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Add tag..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              className="h-8 text-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={addTag}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  <Tag className="h-3 w-3" />
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Assign to Agents */}
        <div className="space-y-2">
          <Label>Assign to Agents</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {agents
              .filter((a) => a.status === 'active')
              .map((agent) => {
                const isAssigned = agentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                      isAssigned ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded border flex items-center justify-center ${
                        isAssigned ? 'bg-primary border-primary text-primary-foreground' : ''
                      }`}
                    >
                      {isAssigned && <span className="text-xs">✓</span>}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.description}</p>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Creating...' : 'Create Skill'}
          </Button>
          <Button variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

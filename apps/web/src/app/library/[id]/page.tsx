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
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SkillEditorPage() {
  const params = useParams();
  const skillId = params.id as string;
  const router = useRouter();
  const { skills, update: updateSkill, remove: deleteSkill } = useSkills();
  const { agents } = useAgents();

  const skill = skills.find((s) => s.id === skillId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Initialize form when skill loads
  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setContent(skill.content);
      setTags(skill.tags);
      setAgentIds(skill.agentIds);
    }
  }, [skill]);

  if (!skill) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Library', href: '/library' }, { label: 'Not Found' }]} />
        <p className="text-muted-foreground">Skill not found.</p>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSkill(skill.id, { name, description, content, tags, agentIds });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this skill?')) return;
    await deleteSkill(skill.id);
    router.push('/library');
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput('');
      setDirty(true);
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
    setDirty(true);
  };

  const toggleAgent = (agentId: string) => {
    setAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
    setDirty(true);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <BreadcrumbNav items={[{ label: 'Library', href: '/library' }, { label: skill.name }]} />

      <div className="flex items-center gap-3">
        <Tip content="Back to library">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to library"
            onClick={() => router.push('/library')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tip>
        <h1 className="text-xl font-bold flex-1">Edit Skill</h1>
        <Button variant="destructive" size="sm" onClick={handleDelete} className="text-xs">
          Delete
        </Button>
      </div>

      <div className="space-y-5">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="skill-desc">Description</Label>
          <Input
            id="skill-desc"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
          />
        </div>

        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="skill-content">Content (Markdown)</Label>
          <Textarea
            id="skill-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            rows={16}
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

        {/* Assigned Agents */}
        <div className="space-y-2">
          <Label>Assigned Agents</Label>
          <p className="text-xs text-muted-foreground">
            Select which agents have access to this skill.
          </p>
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
          <Button onClick={handleSave} disabled={saving || !dirty} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/library')}>
            Cancel
          </Button>
          {dirty && <p className="text-xs text-amber-500 self-center">Unsaved changes</p>}
        </div>
      </div>
    </div>
  );
}

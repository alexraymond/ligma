'use client';

/**
 * Library — master–detail catalogs (UX spec §6).
 *
 * Three catalogs, one browsing shell: the vendored design systems (with a live
 * preview pane), the skills the agents can be given, and the vendored craft
 * rules the critic scores designs against. They share `MasterDetail` on
 * purpose — one filter box, one keyboard model, one selection gesture, so
 * moving between them costs nothing to learn (seam rule 5).
 *
 * All three are *local* catalogs. There is no marketplace behind them and no
 * remote to sync with — "Library is local catalogs until there's something to
 * distribute" (UX spec §10).
 */

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ErrorState } from '@/components/error-state';
import { CreateYourOwnCard } from '@/components/library/authoring-guide';
import {
  fetchCraftRules,
  fetchDesignSystem,
  fetchSkillCatalog,
  fetchSkillCatalogEntry,
  rankByUse,
} from '@/components/library/catalog';
import { DesignSystemDetailPane } from '@/components/library/design-system-detail';
import { FacetBar, FacetSelect, SavedFacetSwitch } from '@/components/library/facet-bar';
import { facetOptions, matchesFacet } from '@/components/library/facets';
import { fetchSkillFacets, useLibraryMeta } from '@/components/library/library-meta';
import { Markdown } from '@/components/library/markdown';
import { MasterDetail } from '@/components/library/master-detail';
import { useDesignSystems } from '@/components/pickers/design-system-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tip } from '@/components/ui/tip';
import { useAgents, useSkills } from '@/hooks/use-data';
import {
  type CraftRule,
  type DesignSystemDetail,
  SKILLS,
  type SkillCatalogDetail,
  type SkillCatalogEntry,
  type SkillDefinition,
  type SkillFacetEntry,
} from '@ligma/api';
import { BookOpen, Check, Copy, Library as LibraryIcon, Plus, Tag, Terminal } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Design systems ──────────────────────────────────────────────────────────

function DesignSystemsCatalog() {
  const { systems, loading, error, reload } = useDesignSystems();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DesignSystemDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const { metaFor, toggleSaved } = useLibraryMeta('design-system');

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    setDetail(null);
    fetchDesignSystem(selectedId)
      .then((next) => {
        if (live) {
          setDetail(next);
          setDetailError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) setDetailError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [selectedId]);

  const categoryOptions = useMemo(
    () => facetOptions(systems.map((system) => system.category)),
    [systems],
  );

  // Facets narrow, then use-count ranks — a system nobody has drawn with yet
  // still shows up (it just sorts after the ones that have), a category or
  // "Saved only" filter is a hard cut.
  const entries = useMemo(() => {
    const filtered = systems
      .filter((system) => matchesFacet(system.category, category))
      .filter((system) => !savedOnly || metaFor(system.id).saved)
      .map((system) => ({
        id: system.id,
        label: system.name,
        meta: system.category,
        blurb: system.blurb,
      }));
    const useCounts = Object.fromEntries(systems.map((s) => [s.id, metaFor(s.id).useCount]));
    return rankByUse(filtered, useCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metaFor closes over the whole map; systems is the real dep.
  }, [systems, category, savedOnly]);

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <MasterDetail
      entries={entries}
      selectedId={selectedId}
      onSelect={setSelectedId}
      noun="design systems"
      loading={loading}
      emptyMessage="No design systems are vendored in this checkout."
      isSaved={(id) => metaFor(id).saved}
      onToggleSave={toggleSaved}
      aboveFilter={
        <>
          <FacetBar>
            <FacetSelect
              label="Category"
              options={categoryOptions}
              selected={category}
              onChange={setCategory}
            />
            <SavedFacetSwitch checked={savedOnly} onChange={setSavedOnly} />
          </FacetBar>
          <div className="flex items-center gap-3">
            <CreateYourOwnCard kind="design-system" />
            <Link
              href="/library/new-design-system"
              className="shrink-0 rounded-md border px-3 py-2 text-sm underline-offset-4 hover:underline"
            >
              New design system
            </Link>
          </div>
        </>
      }
    >
      {detailError ? (
        <ErrorState message={detailError} onRetry={() => setSelectedId(selectedId)} />
      ) : (
        <DesignSystemDetailPane detail={detail} />
      )}
    </MasterDetail>
  );
}

// ─── Skills ──────────────────────────────────────────────────────────────────

function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Tip content={copied ? 'Copied!' : 'Copy to clipboard'}>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={handleCopy}
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </Tip>
  );
}

function SkillDetail({ skill, agentNames }: { skill: SkillDefinition; agentNames: string[] }) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{skill.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{skill.description}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/library/${skill.id}`}>Edit</Link>
        </Button>
      </div>

      {agentNames.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Agents:</span>
          {agentNames.map((name) => (
            <Badge key={name} variant="outline" className="text-[10px]">
              {name}
            </Badge>
          ))}
        </div>
      ) : null}

      {skill.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Tag className="h-3 w-3 text-muted-foreground" aria-hidden />
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="max-h-[36rem] overflow-y-auto rounded-lg border bg-background p-4">
        <Markdown source={skill.content} />
      </div>
    </div>
  );
}

function SkillsCatalog() {
  const { skills, loading, error, refetch } = useSkills();
  const { agents } = useAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      skills.map((skill) => ({
        id: skill.id,
        label: skill.name,
        meta: skill.tags.join(' · '),
        blurb: skill.description,
      })),
    [skills],
  );
  const selected = skills.find((skill) => skill.id === selectedId) ?? null;
  const agentNames = useCallback(
    (ids: string[]) => ids.map((id) => agents.find((agent) => agent.id === id)?.name ?? id),
    [agents],
  );

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <MasterDetail
        entries={entries}
        selectedId={selectedId}
        onSelect={setSelectedId}
        noun="skills"
        loading={loading}
        emptyMessage="No skills yet — create one to give an agent specialised knowledge."
      >
        {selected ? (
          <SkillDetail skill={selected} agentNames={agentNames(selected.agentIds)} />
        ) : (
          <div className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </MasterDetail>

      {/* Slash commands for Claude Code. Not a skill record — a reference card
          for the CLI — but it belongs beside the skills it names. */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Terminal className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI Commands</h2>
            <p className="text-xs text-muted-foreground">
              Slash commands for Claude Code — type in the CLI to activate
            </p>
          </div>
        </div>
        <div className="divide-y">
          {SKILLS.map((skill) => (
            <div key={skill.command} className="flex items-center gap-3 px-5 py-2.5">
              <code className="min-w-[130px] font-mono text-xs font-medium text-primary">
                {skill.command}
              </code>
              <span className="flex-1 text-xs text-muted-foreground">{skill.longDescription}</span>
              <CopyButton text={skill.command} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Craft rules ─────────────────────────────────────────────────────────────

function CraftRulesCatalog() {
  const [rules, setRules] = useState<CraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchCraftRules()
      .then((next) => {
        setRules(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const [savedOnly, setSavedOnly] = useState(false);
  const { metaFor, toggleSaved, recordUse } = useLibraryMeta('craft');

  const entries = useMemo(() => {
    const filtered = rules
      .filter((rule) => !savedOnly || metaFor(rule.id).saved)
      .map((rule) => ({ id: rule.id, label: rule.title, meta: rule.id, blurb: rule.blurb }));
    const useCounts = Object.fromEntries(rules.map((r) => [r.id, metaFor(r.id).useCount]));
    return rankByUse(filtered, useCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metaFor closes over the whole map; rules is the real dep.
  }, [rules, savedOnly]);
  const selected = rules.find((rule) => rule.id === selectedId) ?? null;

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <MasterDetail
      entries={entries}
      selectedId={selectedId}
      onSelect={setSelectedId}
      noun="craft rules"
      loading={loading}
      emptyMessage="No craft rules are vendored in this checkout."
      isSaved={(id) => metaFor(id).saved}
      onToggleSave={toggleSaved}
      aboveFilter={
        <>
          <FacetBar>
            <SavedFacetSwitch checked={savedOnly} onChange={setSavedOnly} />
          </FacetBar>
          <CreateYourOwnCard kind="craft" />
        </>
      }
    >
      {selected ? (
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">{selected.title}</h2>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                craft/{selected.id}.md
              </p>
            </div>
            <CopyButton text={`craft/${selected.id}.md`} onCopied={() => recordUse(selected.id)} />
          </div>
          <div className="max-h-[42rem] overflow-y-auto rounded-lg border bg-background p-4">
            <Markdown source={selected.body} />
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </MasterDetail>
  );
}

// ─── Skill catalog (vendored skills/, OD-077) ────────────────────────────────
//
// Distinct from the "Skills" tab above: that one lists the SkillDefinition
// records the user authors for agents (/api/skills). This lists the vendored
// `skills/` directory — 136 packaged SKILL.md skills shipped in the repo,
// served by /api/skill-catalog — the same "read-only vendored catalog"
// pattern as design systems and craft rules.

function SkillCatalogDetailPane({
  detail,
  facet,
  onCopy,
}: {
  detail: SkillCatalogDetail | null;
  facet?: SkillFacetEntry;
  onCopy: () => void;
}) {
  if (!detail) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{detail.title}</h2>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            skills/{detail.id}/SKILL.md
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">{detail.description}</p>
        </div>
        <CopyButton text={`skills/${detail.id}/SKILL.md`} onCopied={onCopy} />
      </div>
      {facet && (facet.mode || facet.category || facet.tags.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1">
          {facet.mode ? <Badge className="text-[10px]">{facet.mode}</Badge> : null}
          {facet.category ? (
            <Badge variant="outline" className="text-[10px]">
              {facet.category}
            </Badge>
          ) : null}
          {facet.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      {detail.files.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Ships with</h3>
          <ul className="space-y-0.5">
            {detail.files.map((file) => (
              <li key={file} className="font-mono text-[10px] text-muted-foreground">
                {file}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="max-h-[42rem] overflow-y-auto rounded-lg border bg-background p-4">
        <Markdown source={detail.body} />
      </div>
    </div>
  );
}

function SkillCatalogTab() {
  const [entries, setEntries] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillCatalogDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Record<string, SkillFacetEntry>>({});
  const [mode, setMode] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const { metaFor, toggleSaved, recordUse } = useLibraryMeta('skill');

  const load = useCallback(() => {
    setLoading(true);
    fetchSkillCatalog()
      .then((next) => {
        setEntries(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Facets ride a separate request (OD-007): the skill-catalog list itself
  // only ever carried id/title/description, and extending that shared shape
  // is outside this feature's owned files (see the handoff notes).
  useEffect(() => {
    fetchSkillFacets()
      .then((skills) => setFacets(Object.fromEntries(skills.map((s) => [s.id, s]))))
      .catch(() => {
        // A facet dropdown that fails to load just shows no options — the
        // catalog itself (already fetched above) still browses fine.
      });
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    setDetail(null);
    fetchSkillCatalogEntry(selectedId)
      .then((next) => {
        if (live) {
          setDetail(next);
          setDetailError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) setDetailError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [selectedId]);

  const modeOptions = useMemo(
    () => facetOptions(Object.values(facets).map((f) => f.mode)),
    [facets],
  );

  const masterEntries = useMemo(() => {
    const filtered = entries
      .filter((entry) => matchesFacet(facets[entry.id]?.mode ?? null, mode))
      .filter((entry) => !savedOnly || metaFor(entry.id).saved)
      .map((entry) => ({ id: entry.id, label: entry.title, blurb: entry.description }));
    const useCounts = Object.fromEntries(entries.map((e) => [e.id, metaFor(e.id).useCount]));
    return rankByUse(filtered, useCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metaFor closes over the whole map; entries/facets/mode/savedOnly are the real deps.
  }, [entries, facets, mode, savedOnly]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <MasterDetail
      entries={masterEntries}
      selectedId={selectedId}
      onSelect={setSelectedId}
      noun="skills"
      loading={loading}
      emptyMessage="No skills are vendored in this checkout."
      isSaved={(id) => metaFor(id).saved}
      onToggleSave={toggleSaved}
      aboveFilter={
        <>
          <FacetBar>
            <FacetSelect label="Kind" options={modeOptions} selected={mode} onChange={setMode} />
            <SavedFacetSwitch checked={savedOnly} onChange={setSavedOnly} />
          </FacetBar>
          <CreateYourOwnCard kind="skill" />
        </>
      }
    >
      {detailError ? (
        <ErrorState message={detailError} onRetry={() => setSelectedId(selectedId)} />
      ) : (
        <SkillCatalogDetailPane
          detail={detail}
          facet={selectedId ? facets[selectedId] : undefined}
          onCopy={() => selectedId && recordUse(selectedId)}
        />
      )}
    </MasterDetail>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

/** The page's primary action follows the active tab (walkthrough m4) — "+ New
 * Skill" makes no sense on the Design systems tab, and there's nothing to
 * create from the read-only vendored catalog or the by-hand craft rules. */
const PRIMARY_ACTION: Partial<Record<string, { href: string; label: string }>> = {
  'design-systems': { href: '/library/new-design-system', label: 'New design system' },
  skills: { href: '/library/new', label: 'New Skill' },
};

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState('design-systems');
  const primaryAction = PRIMARY_ACTION[activeTab];

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Library' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Design systems, skills, the vendored skill catalog and craft rules — the catalogs every
            composer picks from.
          </p>
        </div>
        {primaryAction && (
          <Tip content={`Create a ${primaryAction.label.toLowerCase()}`}>
            <Button size="sm" asChild className="gap-1.5">
              <Link href={primaryAction.href}>
                <Plus className="h-3.5 w-3.5" /> {primaryAction.label}
              </Link>
            </Button>
          </Tip>
        )}
      </div>

      <Tabs defaultValue="design-systems" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="design-systems">Design systems</TabsTrigger>
          <TabsTrigger value="skills">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Skills
          </TabsTrigger>
          <TabsTrigger value="skill-catalog">
            <LibraryIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Skill catalog
          </TabsTrigger>
          <TabsTrigger value="craft-rules">Craft rules</TabsTrigger>
        </TabsList>

        <TabsContent value="design-systems" className="mt-4">
          <DesignSystemsCatalog />
        </TabsContent>
        <TabsContent value="skills" className="mt-4">
          <SkillsCatalog />
        </TabsContent>
        <TabsContent value="skill-catalog" className="mt-4">
          <SkillCatalogTab />
        </TabsContent>
        <TabsContent value="craft-rules" className="mt-4">
          <CraftRulesCatalog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

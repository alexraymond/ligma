'use client';

/**
 * "Create your own" (OD-158/159) — one card per catalog tab, opening a short
 * guide to that catalog's on-disk format. Not a wizard: there is no form here
 * that writes a new package to disk (a design-system creation wizard is its
 * own contract row, S4/OD-010). This is the entry point that tells a human
 * where to put the files by hand and what shape they need, same as
 * open-design's `home-hero/plugin-authoring.ts` pointed at its plugin
 * manifest shape, adapted to ligma's own three vendored trees.
 *
 * Content is written fresh against what this repo's own routes actually read
 * (`design-systems/route.ts`, `skill-catalog/route.ts`, `craft-rules/route.ts`)
 * — not a description of where the bundled catalogs originally came from.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from './markdown';

export type AuthoringGuideKind = 'design-system' | 'skill' | 'craft';

const GUIDES: Record<AuthoringGuideKind, { title: string; body: string }> = {
  'design-system': {
    title: 'Add a design system',
    body: `A design system is a directory under \`design-systems/<id>/\`. \`GET /api/design-systems\` reads \`manifest.json\` and \`tokens.css\` — that's the minimum a package needs to show up in this catalog.

\`\`\`
design-systems/<id>/
  manifest.json      # required: id, name, category, description
  tokens.css         # required: :root { --bg; --surface; --fg; --muted; --border; --accent; ... }
  DESIGN.md           # optional: the prose the generation agent is handed
  components.html     # optional: a real live preview (shown in a sandboxed iframe)
  preview/             # optional: extra static pages, declared in manifest.json's preview.pages
\`\`\`

\`manifest.json\`'s \`category\` is the facet this catalog is filtered by, so pick one that groups sensibly with the others already vendored (Design systems tab → filter by category to see the existing set).

Without \`components.html\`, the Library falls back to a specimen built from your \`tokens.css\` — so a package with tokens alone still previews, just not at full fidelity.

\`id\` is the directory name and doubles as the slug stored on any design drawn with it, so pick it once and don't rename the folder later.`,
  },
  skill: {
    title: 'Add a skill',
    body: `A vendored skill is a directory under \`skills/<id>/\` containing one file: \`SKILL.md\`. \`GET /api/skill-catalog\` reads its YAML frontmatter for the list view and its body for the detail pane.

\`\`\`
skills/<id>/
  SKILL.md    # required: --- frontmatter --- then the skill's body in markdown
  <anything else>   # optional: templates, examples — listed as "Ships with" in the detail pane
\`\`\`

Frontmatter only needs \`name\` and \`description\` to show up in the catalog:

\`\`\`yaml
---
name: my-skill
description: One sentence — what an agent uses this for.
---
\`\`\`

Two more fields are worth setting, because the Library filters skills by them: an \`od.mode\` block (\`design-system\`, \`prototype\`, \`image\`, \`video\`, \`template\`, \`deck\`, \`utility\`, \`audio\`, or \`design\`) is this catalog's "Kind" facet, and a top-level \`category\` plus \`tags: [...]\` array is the finer-grained scheme a curated subset of skills already carries.

Nothing in the body is read for filtering — only frontmatter fields, so a skill's facets never depend on how its prose happens to be worded.`,
  },
  craft: {
    title: 'Add a craft rule',
    body: `A craft rule is one file: \`craft/<id>.md\`. \`GET /api/craft-rules\` reads every \`.md\` file in that directory except \`README.md\` and \`FUTURE_SECTIONS.md\`, which are the directory's own documentation, not rules.

\`\`\`
craft/<id>.md
\`\`\`

The file's \`# \` heading becomes the rule's title, and the paragraph right under it becomes its one-line summary in the list — the same convention \`design-systems/*/DESIGN.md\` uses for its own blurb. Everything after that is the rule's body, rendered verbatim in the detail pane and handed to the studio critic when it scores a design.

Craft rules carry no frontmatter, so there is no facet to fill in here — filtering a rule by anything other than "Saved" would mean scanning its prose for a category, which this Library deliberately does not do.`,
  },
};

export function CreateYourOwnCard({ kind }: { kind: AuthoringGuideKind }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDES[kind];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Create your own
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{guide.title}</DialogTitle>
        </DialogHeader>
        <Markdown source={guide.body} />
        <Button variant="ghost" size="sm" className="mt-2 self-end" onClick={() => setOpen(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}

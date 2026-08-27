'use client';

/**
 * One design system, shown rather than described.
 *
 * The pane leads with a **live preview** — the package's own `components.html`
 * in a locked-down iframe, or its `tokens.css` applied to a specimen when it
 * ships none. That is the point of the catalog: a name and a category tell you
 * nothing about whether a system suits the brief, and a screenshot would go
 * stale the moment the tokens change. Below it, the swatches, the DESIGN.md the
 * generation agent is actually handed, and the design sessions drawn with it —
 * seam rule 3's "what this made", so the catalog is not a dead end.
 */

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { DesignSystemDetail as Detail } from '@ligma/api';
import { ExternalLink, Layers } from 'lucide-react';
import Link from 'next/link';
import { packageFileHref, previewIsAuthored, previewSrcdoc } from './catalog';
import { Markdown } from './markdown';

export function DesignSystemPreview({ detail, className }: { detail: Detail; className?: string }) {
  return (
    <iframe
      // The catalog renders vendored HTML we do not re-verify on every read:
      // an empty `sandbox` grants nothing — no scripts, no same-origin, no
      // forms, no navigation — so the preview can only ever paint pixels.
      sandbox=""
      srcDoc={previewSrcdoc(detail)}
      title={`${detail.name} preview`}
      className={className ?? 'h-[28rem] w-full rounded-lg border bg-white'}
    />
  );
}

export function DesignSystemSwatches({ detail }: { detail: Detail }) {
  const entries = Object.entries(detail.swatches);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([token, value]) => (
        <div key={token} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1">
          <span
            className="h-4 w-4 shrink-0 rounded border"
            style={{ background: value }}
            aria-hidden
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            --{token} {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DesignSystemDetailPane({ detail }: { detail: Detail | null }) {
  if (!detail) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{detail.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail.blurb}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {detail.category}
        </Badge>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Live preview</h3>
          <span className="text-[10px] text-muted-foreground">
            {previewIsAuthored(detail)
              ? 'components.html, rendered in a sandbox'
              : 'no components.html — tokens.css on a specimen'}
          </span>
        </div>
        <DesignSystemPreview detail={detail} />
        {detail.previewPages.length > 0 ? (
          // Naming a file nobody can open is the seam defect this product
          // exists to kill (D7 OD-071): every declared page is now a link the
          // daemon actually serves.
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
            <span>
              Package also ships these under <code className="font-mono">preview/</code>:
            </span>
            {detail.previewPages.map((page) => (
              <a
                key={page.path}
                href={packageFileHref(detail.id, page.path)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {page.title}
              </a>
            ))}
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Tokens</h3>
        <DesignSystemSwatches detail={detail} />
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          Used by {detail.usedBy.length === 0 ? '' : `(${detail.usedBy.length})`}
        </h3>
        {detail.usedBy.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No design session has used this system yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {detail.usedBy.map((use) => (
              <li key={use.designId}>
                <Link
                  href={`/projects/${use.projectId}/studio`}
                  className="flex items-center gap-1.5 text-xs hover:underline"
                >
                  <Layers className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <span className="truncate">{use.title}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {use.status}
                  </Badge>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">DESIGN.md</h3>
        <div className="max-h-[36rem] overflow-y-auto rounded-lg border bg-background p-4">
          <Markdown source={detail.design} />
        </div>
      </div>
    </div>
  );
}

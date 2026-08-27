'use client';

// "Use ligma everywhere" guide modal — reachable from the command bar.
// Renders the content in ./sections.ts (CLI + HTTP API) with a
// copy-to-clipboard button on every snippet. No React state lives in
// sections.ts so the content stays testable without a DOM.

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { GUIDE_SECTIONS } from './sections';

interface UseEverywhereModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UseEverywhereModal({ open, onOpenChange }: UseEverywhereModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Use ligma everywhere</DialogTitle>
          <DialogDescription>
            Drive ligma from a shell script or your own HTTP client — not just this UI.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={GUIDE_SECTIONS[0]?.id}>
          <TabsList>
            {GUIDE_SECTIONS.map((section) => (
              <TabsTrigger
                key={section.id}
                value={section.id}
                data-testid={`use-everywhere-tab-${section.id}`}
              >
                {section.tabLabel}
              </TabsTrigger>
            ))}
          </TabsList>

          {GUIDE_SECTIONS.map((section) => (
            <TabsContent
              key={section.id}
              value={section.id}
              data-testid={`use-everywhere-section-${section.id}`}
            >
              <h3 className="text-sm font-semibold">{section.heading}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{section.intro}</p>

              {section.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}

              <div className="mt-4 space-y-3">
                {section.snippets.map((snippet, idx) => (
                  <SnippetBlock
                    key={`${section.id}-${idx}`}
                    label={snippet.label}
                    body={snippet.body}
                  />
                ))}
              </div>

              {section.footer && (
                <p className="mt-3 text-xs text-muted-foreground">{section.footer}</p>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

const COPY_RESET_MS = 1600;

function SnippetBlock({ label, body }: { label: string; body: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      // ponytail: clipboard permission denial has no user-visible fallback
      // worth building for a localhost dev tool — the snippet text is still
      // selectable in the <pre> below.
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={onCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs">
        <code>{body}</code>
      </pre>
    </div>
  );
}

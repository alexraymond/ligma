'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { ExternalLink, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Static per root package.json's own `homepage` — not worth a fetch of its own. */
const REPO_URL = 'https://github.com/alexraymond/ligma';

interface AboutInfo {
  version: string;
  commit: string | null;
}

export function AboutCard() {
  const [info, setInfo] = useState<AboutInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/about')
      .then((res) => (res.ok ? (res.json() as Promise<AboutInfo>) : null))
      .then((data) => {
        if (!cancelled && data) setInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          About
        </CardTitle>
        <CardDescription className="mt-1.5">ligma — the autonomous app factory.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-muted-foreground text-xs">Version</p>
            <p className="font-mono">{info?.version ?? '...'}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Commit</p>
            <p className="font-mono">{info?.commit ?? 'unknown'}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 pt-2 border-t">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground w-fit"
          >
            <ExternalLink className="h-3 w-3" /> Repository
          </a>
          <a
            href={`${REPO_URL}/blob/main/docs/evidence/DONE.md`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground w-fit"
          >
            <ExternalLink className="h-3 w-3" /> Evidence log (DONE.md)
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

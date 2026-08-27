'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tip';
import { useDaemon } from '@/hooks/use-daemon';
import { apiFetch } from '@/lib/api-client';
import { FolderCog, Pencil, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Where built products get their own git checkout (OD-097). The root itself
 * is resolved daemon-side (product-repo.ts's `productsRootInfo`) because the
 * `LIGMA_PRODUCTS_DIR` env var lives in the daemon's process, not the browser
 * — this card fetches the effective answer rather than recomputing it.
 */

interface ProductRootInfo {
  path: string;
  source: 'env' | 'configured' | 'default';
}

const SOURCE_LABEL: Record<ProductRootInfo['source'], string> = {
  env: 'LIGMA_PRODUCTS_DIR',
  configured: 'configured here',
  default: 'default',
};

export function ProjectLocationsCard() {
  const { config, updateConfig } = useDaemon();
  const [info, setInfo] = useState<ProductRootInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [productsDir, setProductsDir] = useState('');
  const [saving, setSaving] = useState(false);

  async function refetchInfo() {
    try {
      const res = await apiFetch('/api/product-root');
      if (res.ok) setInfo(await res.json());
    } catch {
      // Best-effort — the effective-path line just stays blank.
    }
  }

  useEffect(() => {
    refetchInfo();
  }, []);

  function startEditing() {
    setProductsDir(config.storage?.productsDir ?? '');
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const trimmed = productsDir.trim();
      // Blank means "use the default", never a literal empty-string root.
      await updateConfig({ storage: { productsDir: trimmed === '' ? null : trimmed } });
      await refetchInfo();
      setEditing(false);
      toast.success('Project location updated');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FolderCog className="h-5 w-5" />
              Project locations
            </CardTitle>
            <CardDescription className="mt-1.5">
              Where built products get their own git checkout.
            </CardDescription>
          </div>
          {!editing && (
            <Tip content="Edit the products root">
              <Button
                variant="ghost"
                size="sm"
                onClick={startEditing}
                className="gap-1.5 text-muted-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Tip>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs">Custom products root</p>
              <Input
                value={productsDir}
                onChange={(e) => setProductsDir(e.target.value)}
                placeholder="~/ligma-products (default)"
                className="h-8 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Blank restores the default.{' '}
                <code className="font-mono text-[11px]">LIGMA_PRODUCTS_DIR</code> always wins over
                this if it&apos;s set in the daemon&apos;s environment.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm space-y-1">
            <p className="text-muted-foreground text-xs">Effective root</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs break-all">{info?.path ?? 'Loading...'}</p>
              {info && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {SOURCE_LABEL[info.source]}
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

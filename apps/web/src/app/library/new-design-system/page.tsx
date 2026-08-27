'use client';

/**
 * Create a design system — S4 (OD-010, OD-069, OD-075).
 *
 * The Library could browse 151 vendored systems and create none. This is the
 * three screens that close that: pick a starting point, review the tokens, name
 * it. What comes out is a package in the vendored layout, so it appears in the
 * same catalog, the same picker and the same preview as everything else.
 *
 * Deliberately *not* here: importing from Figma. That connector needs OAuth
 * credentials nobody has configured, and a button that opens a dialog asking
 * for an app key it cannot use is worse than an honest absence — so the first
 * step names it as a non-goal instead of pretending.
 */

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tip } from '@/components/ui/tip';
import {
  type BrandExtraction,
  SCRATCH_TOKENS,
  WizardError,
  createDesignSystem,
  extractBrand,
  isColorToken,
  missingTokens,
  orderedTokens,
  previewSrcdoc,
  slugify,
} from '@/runtime/brand-tokens';
import { ArrowLeft, Check, Globe, Loader2, Palette, Save, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type Step = 1 | 2 | 3;

const STEPS: Array<{ step: Step; label: string }> = [
  { step: 1, label: 'Start' },
  { step: 2, label: 'Review tokens' },
  { step: 3, label: 'Name & create' },
];

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
      {STEPS.map(({ step, label }, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span className="text-muted-foreground/40">→</span>}
          <span
            className={
              step === current
                ? 'font-medium text-foreground'
                : step < current
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
            }
            aria-current={step === current ? 'step' : undefined}
          >
            {step < current && <Check className="mr-1 inline h-3.5 w-3.5" />}
            {step}. {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  const className =
    tone === 'error'
      ? 'border-destructive bg-destructive/10 text-destructive'
      : 'border-border bg-muted/40 text-muted-foreground';
  return <div className={`rounded-lg border px-4 py-3 text-sm ${className}`}>{children}</div>;
}

export default function NewDesignSystemPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [extraction, setExtraction] = useState<BrandExtraction | null>(null);
  const [url, setUrl] = useState('');
  const [extracting, setExtracting] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [blurb, setBlurb] = useState('');
  const [saving, setSaving] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const rows = useMemo(() => orderedTokens(tokens), [tokens]);
  const missing = useMemo(() => missingTokens(tokens), [tokens]);
  const id = slugify(name);

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    setDetails(err instanceof WizardError ? err.details : []);
    setOverwrite(err instanceof WizardError && err.overwritable);
  };

  const startFromScratch = () => {
    setError(null);
    setDetails([]);
    setExtraction(null);
    setTokens({ ...SCRATCH_TOKENS });
    setStep(2);
  };

  const startFromUrl = async () => {
    setError(null);
    setDetails([]);
    setExtracting(true);
    try {
      const result = await extractBrand(url.trim());
      setExtraction(result);
      setTokens({ ...result.tokens });
      if (!name.trim()) setName(new URL(result.url).hostname.replace(/^www\./, ''));
      setStep(2);
    } catch (err) {
      fail(err);
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    setError(null);
    setDetails([]);
    setSaving(true);
    try {
      await createDesignSystem({
        name: name.trim(),
        tokens,
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(blurb.trim() ? { blurb: blurb.trim() } : {}),
        ...(extraction ? { sourceUrl: extraction.url } : {}),
        ...(overwrite ? { overwrite: true } : {}),
      });
      router.push('/library');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <BreadcrumbNav
        items={[{ label: 'Library', href: '/library' }, { label: 'New design system' }]}
      />

      <div className="flex items-center gap-3">
        <Tip content="Back">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => (step === 1 ? router.back() : setStep((step - 1) as Step))}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tip>
        <h1 className="text-xl font-bold">Create a design system</h1>
      </div>

      <Stepper current={step} />

      {error && (
        <Notice tone="error">
          <p>{error}</p>
          {details.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={startFromScratch}
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted"
            >
              <Palette className="mb-2 h-5 w-5 text-muted-foreground" />
              <p className="font-medium">Start from scratch</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A neutral palette and the system font stack, ready to edit.
              </p>
            </button>

            <div className="rounded-xl border bg-card p-5">
              <Globe className="mb-2 h-5 w-5 text-muted-foreground" />
              <p className="font-medium">From a website</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Reads the page&apos;s own CSS and proposes tokens you review before anything is
                created.
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  id="brand-url"
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && url.trim()) void startFromUrl();
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  disabled={!url.trim() || extracting}
                  onClick={() => void startFromUrl()}
                >
                  {extracting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <Notice tone="info">
            <p className="font-medium text-foreground">Two things this does not do</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              <li>
                <strong>No Figma import.</strong> Pulling a library out of Figma needs OAuth
                credentials this install has no way to obtain, so it is a documented non-goal rather
                than a button that fails. Export your Figma variables to CSS and paste the values
                here instead.
              </li>
              <li>
                <strong>No model runs.</strong> Extraction is a measurement of the CSS a page ships
                — colours, custom properties, <code>theme-color</code> and font families. Nothing is
                generated or guessed beyond what the review step tells you was inferred.
              </li>
            </ul>
          </Notice>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          {extraction && (
            <div className="space-y-3 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Measured from {extraction.url}</p>
                <Badge variant="secondary">{extraction.colors.length} colours</Badge>
                <Badge variant="secondary">{extraction.fonts.length} families</Badge>
                {extraction.stylesheets.length > 0 && (
                  <Badge variant="secondary">{extraction.stylesheets.length} stylesheets</Badge>
                )}
              </div>
              {extraction.colors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {extraction.colors.map((color) => (
                    <span
                      key={color.hex}
                      title={`${color.hex} ×${color.count} — ${color.sources.join('; ')}`}
                      className="flex items-center gap-1.5 rounded-md border px-1.5 py-1"
                    >
                      <span
                        className="h-4 w-4 shrink-0 rounded border"
                        style={{ background: color.hex }}
                        aria-hidden
                      />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {color.hex}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {extraction.fonts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Families found: {extraction.fonts.map((font) => font.family).join(', ')}
                </p>
              )}
              {extraction.notes.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {extraction.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-3">
            <Label>Tokens</Label>
            <p className="text-xs text-muted-foreground">
              Radius, spacing, elevation and motion are filled from the shared schema defaults when
              the system is created — only the tokens a brand actually decides are edited here.
            </p>
            <div className="space-y-2">
              {rows.map(([token, value]) => (
                <div key={token} className="flex items-center gap-2">
                  {isColorToken(token) && (
                    <span
                      className="h-8 w-8 shrink-0 rounded-md border"
                      style={{ background: value }}
                      aria-hidden
                    />
                  )}
                  <Label htmlFor={`token-${token}`} className="w-32 shrink-0 font-mono text-xs">
                    --{token}
                  </Label>
                  <Input
                    id={`token-${token}`}
                    value={value}
                    onChange={(event) =>
                      setTokens((prev) => ({ ...prev, [token]: event.target.value }))
                    }
                    className="h-8 font-mono text-sm"
                  />
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-destructive">
                Required and still empty: {missing.map((token) => `--${token}`).join(', ')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Preview</Label>
            <iframe
              // Nothing here is trusted: the token values may have come from a
              // remote page's CSS. An empty sandbox grants no scripts, no
              // same-origin, no navigation — it can only paint.
              sandbox=""
              srcDoc={previewSrcdoc(tokens)}
              title="Token preview"
              className="h-72 w-full rounded-lg border bg-white"
            />
          </div>

          <div className="flex gap-3">
            <Button onClick={() => setStep(3)} disabled={missing.length > 0}>
              Continue
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ds-name">Name *</Label>
            <Input
              id="ds-name"
              placeholder="e.g. Acme Studio"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Saved as <code className="font-mono">design-systems/{id || '…'}/</code>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ds-category">Category</Label>
            <Input
              id="ds-category"
              placeholder="User-created"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ds-blurb">One-line summary</Label>
            <Input
              id="ds-blurb"
              placeholder="What this system is for."
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
            />
          </div>

          <Notice tone="info">
            <p className="font-medium text-foreground">Revisions</p>
            <p className="mt-1">
              The vendored package format carries no version field, so this wizard does not create
              one either: creating a system you already authored{' '}
              <strong>replaces its three files in place</strong>, and no previous revision is kept.
              You will be asked to confirm before that happens. Vendored systems are never
              overwritten, whatever name you type. Real revision history is a later change.
            </p>
          </Notice>

          {overwrite && (
            <Notice tone="error">
              <p>
                <strong>{id}</strong> already exists and you authored it. Creating it again
                overwrites its files — there is no undo.
              </p>
            </Notice>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => void submit()}
              disabled={saving || !name.trim()}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {overwrite ? 'Overwrite it' : saving ? 'Creating…' : 'Create design system'}
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

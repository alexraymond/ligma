/**
 * The studio canvas surface, scoped to the canvas edge.
 *
 * These tokens are declared on `.ligma-studio-canvas` and nowhere else — the
 * composer, the rail, the sheets and every tab outside the canvas keep the
 * cockpit's shadcn surface, and no cockpit component can accidentally
 * inherit them. Walkthrough review: an earlier warm paper palette here (hue
 * ~80, an olive-brown) read as a stray color found nowhere else in the app —
 * these values now match the app's own neutral tokens (`globals.css`
 * `--background`/`--card`/`--border`, hue 0 in light mode, hue 250 in dark),
 * so the canvas is a neutral surface like the rest of the product.
 *
 * ponytail: a scoped `<style>` rather than an edit to the shared `globals.css`
 * — the studio is one surface and this is the only place that reads these.
 * Promote them into `tokens.css` when a second surface wants them.
 */
export function StudioPaperTokens() {
  return (
    <style>{`
.ligma-studio-canvas {
  --paper-bg: oklch(0.968 0 0);
  --paper-card: oklch(0.995 0 0);
  --paper-line: oklch(0.885 0 0);
  --paper-ink: oklch(0.28 0 0);
  --paper-ink-muted: oklch(0.52 0 0);
  --paper-accent: oklch(0.58 0.16 270.94);
  --paper-on-accent: oklch(0.99 0 0);
  --paper-shadow: 0 1px 2px oklch(0.4 0 0 / 0.10), 0 8px 20px oklch(0.4 0 0 / 0.07);
  background:
    radial-gradient(oklch(0.4 0 0 / 0.035) 1px, transparent 1px) 0 0 / 18px 18px,
    var(--paper-bg);
  color: var(--paper-ink);
}
.dark .ligma-studio-canvas {
  --paper-bg: oklch(0.235 0.014 250);
  --paper-card: oklch(0.285 0.014 250);
  --paper-line: oklch(0.38 0.016 250);
  --paper-ink: oklch(0.93 0.012 250);
  --paper-ink-muted: oklch(0.70 0.012 250);
  --paper-accent: oklch(0.70 0.14 265);
  --paper-on-accent: oklch(0.20 0.02 250);
  --paper-shadow: 0 1px 2px oklch(0 0 0 / 0.35), 0 8px 20px oklch(0 0 0 / 0.30);
}
.ligma-studio-canvas.ligma-panning, .ligma-studio-canvas.ligma-panning * { cursor: grabbing !important; }
`}</style>
  );
}

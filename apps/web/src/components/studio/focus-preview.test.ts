/**
 * P3: `PreviewSlot`'s srcdoc memo used to key on `stablePreviewSourceKey`,
 * which blanks EDITMODE tokens out on the assumption that a token-only tweak
 * rides a postMessage to the already-live iframe instead of rebuilding it.
 * That postMessage side of the bridge was never built (the overlay script has
 * no message type for it — packages/runtime/src/overlay.ts), so a tweak keyed
 * out of the memo never reached the iframe: "Applied live" and the preview
 * silently stayed on the old value. No jsdom in this vitest config, so this
 * pins the source fact a render would otherwise verify.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './focus-preview.tsx'), 'utf-8');

describe('PreviewSlot srcDoc — keyed on the real body (P3)', () => {
  it('keys the srcDoc memo on `body`, not the token-blanked stableKey', () => {
    expect(SOURCE).toContain(
      'const srcDoc = useMemo(() => withDeckNav(buildDesignSrcdoc(body)), [body]);',
    );
    expect(SOURCE).not.toContain(
      'import { buildDesignSrcdoc, postToIframe, stablePreviewSourceKey }',
    );
  });
});

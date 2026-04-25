import { describe, expect, it } from 'vitest';
import { buildWallReferenceBlock } from './store';

describe('buildWallReferenceBlock', () => {
  it('returns null when no paths are selected', () => {
    expect(buildWallReferenceBlock([], {}, 'design-1')).toBeNull();
  });

  it('returns null when designId is null', () => {
    const map = { 'design-1::index.html': '<html>hi</html>' };
    expect(buildWallReferenceBlock(['index.html'], map, null)).toBeNull();
  });

  it('inlines each selected file under a labelled section', () => {
    const map = {
      'design-1::index.html': '<html>landing</html>',
      'design-1::dashboard.html': '<html>dash</html>',
    };
    const block = buildWallReferenceBlock(['index.html', 'dashboard.html'], map, 'design-1');
    expect(block).toContain('## REFERENCED DESIGNS');
    expect(block).toContain('### index.html');
    expect(block).toContain('<html>landing</html>');
    expect(block).toContain('### dashboard.html');
    expect(block).toContain('<html>dash</html>');
  });

  it('skips paths missing from the file map without erroring', () => {
    const map = { 'design-1::index.html': '<html>only one</html>' };
    const block = buildWallReferenceBlock(['index.html', 'missing.html'], map, 'design-1');
    expect(block).toContain('### index.html');
    expect(block).not.toContain('### missing.html');
  });

  it('truncates files larger than the per-file cap', () => {
    const big = 'x'.repeat(8000);
    const map = { 'design-1::big.html': big };
    const block = buildWallReferenceBlock(['big.html'], map, 'design-1');
    expect(block).toContain('[truncated]');
    // Body excluding wrapper lines should be no more than the cap-ish.
    expect(block).toContain(big.slice(0, 4000));
    expect(block).not.toContain('xxxx'.repeat(2000));
  });
});

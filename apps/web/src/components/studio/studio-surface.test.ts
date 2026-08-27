/**
 * Honest-mode proofs for the Studio surface (§16 "Honest copy debts").
 *
 * The surface needs a browser to render (SSE, canvas, dnd) and this vitest
 * config is node-only, so the flags and the copy are read out of the source —
 * the same fs-proof pattern the board and project pages use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './studio-surface.tsx'), 'utf-8');

describe('studio surface — honest mode', () => {
  it('opens the tweaks panel by default', () => {
    expect(SOURCE).toContain("useState<'tweaks' | 'versions'>('tweaks')");
  });

  it("names the export group 'Share design'", () => {
    expect(SOURCE).toContain('<DropdownMenuLabel>Share design</DropdownMenuLabel>');
  });

  it('names the canvas mode', () => {
    expect(SOURCE).toContain('Review canvas — you shape it by asking, not by dragging.');
  });

  it("carries the 'Two things this does not do' disclosure with both claims", () => {
    expect(SOURCE).toContain('Two things this does not do');
    expect(SOURCE).toContain('Direct manipulation.');
    expect(SOURCE).toMatch(/or drop a\s+pin on the element/);
    expect(SOURCE).toContain('A live product preview.');
    expect(SOURCE).toContain('proven in Proof');
  });

  it('keeps both claims true: no element drag handler, and the canvas renders design bodies', () => {
    // The only drag on the canvas is Wall card reordering — nothing inside a
    // rendered screen gets a drag handler or a `draggable` attribute. Scoped
    // to the canvas half of the file rather than the whole of it: the composer
    // takes a drag *to attach a reference image*, which is a drop onto a text
    // box and says nothing about whether a rendered screen can be manipulated.
    const canvas = SOURCE.slice(
      SOURCE.indexOf('Canvas + critique lane'),
      SOURCE.indexOf('Pin bubble'),
    );
    expect(canvas).not.toMatch(/draggable=/);
    expect(canvas).not.toMatch(/onDrag[A-Z]/);
    expect(canvas).toContain('bodies={live.bodies}');
  });
});

/**
 * The full-screen workspace (spec 2026-08-26-studio-fullscreen-workspace-design).
 * Same fs-proof pattern: the layout and the wiring are read out of the source.
 */
describe('studio surface — full-screen workspace', () => {
  it('fills the viewport instead of the old in-shell panel height', () => {
    expect(SOURCE).toContain('h-[100dvh]');
    expect(SOURCE).not.toContain('h-[calc(100vh-19rem)]');
  });

  it('carries a slim bar with the way out, the project name and the moved controls', () => {
    const bar = SOURCE.slice(SOURCE.indexOf('Slim bar'), SOURCE.indexOf('Composer pane'));
    expect(bar).toContain('h-10');
    expect(bar).toContain('aria-label="Back to Build"');
    expect(bar).toContain('{projectName}');
    expect(bar).toContain('Wall');
    expect(bar).toContain('Focus');
    expect(bar).toContain('VIEWPORTS.map');
    expect(bar).toContain('aria-label="Versions and tweaks"');
    expect(bar).toContain('Export');
    expect(bar).toContain('Promote to build');
  });

  it('the back arrow and the ESC exit go to the same Build route', () => {
    expect(SOURCE).toContain(
      'const buildHref = `/projects/${encodeURIComponent(projectId)}/board`',
    );
    expect(SOURCE).toContain('router.push(buildHref)');
  });

  it('remembers the composer collapse per project', () => {
    expect(SOURCE).toContain('ligma:studio:composer-collapsed:${projectId}');
    expect(SOURCE).toContain('window.localStorage.setItem(composerKey');
    expect(SOURCE).toContain('aria-label="Hide composer"');
    expect(SOURCE).toContain('aria-label="Show composer"');
  });

  it('remembers the zoom per design, and every change goes through the one setter', () => {
    expect(SOURCE).toContain('ligma:studio:zoom:${designId}');
    expect(SOURCE).toContain('window.localStorage.setItem(zoomKey');
    // The ± buttons and the canvas's own wheel-zoom must not bypass the memory.
    expect(SOURCE).toContain('onZoomChange={changeZoom}');
    expect(SOURCE).not.toMatch(/onClick=\{\(\) => setZoom\(/);
  });

  it('walks the ESC chain through the shared step function, not an inline ladder', () => {
    expect(SOURCE).toContain(
      'studioEscapeStep({ pinDraft: pinDraft !== null, commentMode, mode })',
    );
    // Inner claimants keep their key: Radix layers that already dismissed it,
    // the Promote sheet, and any focused text field.
    expect(SOURCE).toContain('e.defaultPrevented');
    expect(SOURCE).toContain('if (promoteOpen) return;');
    expect(SOURCE).toContain(
      'target?.closest("input, textarea, select, [contenteditable=\'true\']")',
    );
  });
});

/**
 * The viewing surface (roadmap phase 5). Same fs-proof pattern: the wiring is
 * read out of the source, because a turn's SSE stream and a canvas cannot be
 * rendered in a node-environment suite.
 */
describe('studio surface — viewing surface', () => {
  it('offers Preview ⇄ Source in Focus, read-only, through the existing CodeView', () => {
    expect(SOURCE).toContain("useState<'preview' | 'source'>('preview')");
    expect(SOURCE).toMatch(/<CodeView\s+path=\{focusedPath\}/);
    expect(SOURCE).toContain('read-only');
    // The pane is a CodeView and nothing else — no editor, no textarea.
    const pane = SOURCE.slice(
      SOURCE.indexOf("focusView === 'source' ? ("),
      SOURCE.indexOf('<FocusPreview'),
    );
    expect(pane).toContain('<CodeView');
    expect(pane).not.toMatch(/Textarea|contentEditable/);
  });

  it('follows the newest artifact, but yields to a choice made during the turn', () => {
    expect(SOURCE).toContain(
      'if (live.writingPath && !userChoseFocus.current) setFocusedPath(live.writingPath)',
    );
  });

  it("opens the references drawer on this route's own panel host", () => {
    expect(SOURCE).toContain("openPanel('references')");
    expect(SOURCE).toContain("next.set('panel', panel)");
  });

  it('puts a PNG on the clipboard, and says so when the browser cannot', () => {
    expect(SOURCE).toContain("new ClipboardItem({ 'image/png': blob })");
    expect(SOURCE).toContain("typeof ClipboardItem === 'undefined'");
  });
});

/**
 * The first-design flow (roadmap phase 6). Same fs-proof pattern.
 */
describe('studio surface — first-design flow', () => {
  it('opens the empty state with one line, then directions, then starters, then the composer', () => {
    expect(SOURCE).toContain('Describe the screens you want');
    const order = ['<DirectionCards', '<StarterPrompts', 'aria-label="Prompt"'].map((needle) =>
      SOURCE.indexOf(needle),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("shows them only at a design's start, and gives the empty state the column", () => {
    expect(SOURCE).toContain(
      'const firstDesign = !designId || (design !== null && design.versions.length === 0 && !busy);',
    );
    expect(SOURCE).toContain("${firstDesign ? 'min-h-0 flex-1' : 'max-h-40 shrink-0'}");
  });

  it('routes a picked direction through the prompt the user can see, not a hidden field', () => {
    expect(SOURCE).toContain('<DirectionCards prompt={prompt} onChange={setPrompt} />');
    expect(SOURCE).toContain('<StarterPrompts prompt={prompt} onChange={setPrompt} />');
  });

  it('retires the bare select for the gallery switcher, both entrances sharing one reset', () => {
    expect(SOURCE).not.toContain('<select\n            aria-label="Design"');
    expect(SOURCE).toContain('<DesignGallery');
    expect(SOURCE).toContain('onSelect={(id) => switchDesign(id)}');
    expect(SOURCE).toContain('onNew={() => switchDesign(null)}');
  });
});

// W9: `busy` (= `live.turnInFlight`) is false whenever `designId` is null, so
// it never guarded the very first turn — a double-click on Send while
// `createDesign` was in flight fired `submitPrompt` twice and created two
// designs. `creatingDesign` closes that window.
describe('studio surface — first-send in-flight guard (W9)', () => {
  it('submitPrompt bails out early while a design is already being created', () => {
    const start = SOURCE.indexOf('const submitPrompt = async');
    const end = SOURCE.indexOf('const addAttachments');
    const body = SOURCE.slice(start, end);
    expect(body).toContain("if (text === '' || creatingDesign) return;");
    expect(body).toContain('setCreatingDesign(true);');
    expect(body).toMatch(/finally\s*{\s*setCreatingDesign\(false\);/);
  });

  it('disables Send and the attach button while the first design is being created', () => {
    expect(SOURCE).toContain(
      '<AttachButton onFiles={addAttachments} disabled={busy || creatingDesign} />',
    );
    expect(SOURCE).toContain("disabled={prompt.trim() === '' || creatingDesign}");
  });
});

// W22: `link.click()` only starts the browser's read of the blob URL;
// revoking it in the same tick raced that read and could cancel the download
// before it began.
describe("studio surface — export download isn't raced by revokeObjectURL (W22)", () => {
  it('defers the revoke instead of calling it right after click()', () => {
    const start = SOURCE.indexOf('const runExport = async');
    const end = SOURCE.indexOf('showSuccess(`Exported', start);
    const body = SOURCE.slice(start, end);
    expect(body).toContain('link.click();');
    expect(body).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(url\), \d+/);
    // The revoke must not run synchronously in the same statement as click().
    expect(body).not.toMatch(/link\.click\(\);\s*\}\s*finally\s*\{\s*URL\.revokeObjectURL/);
  });
});

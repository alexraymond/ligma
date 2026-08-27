/**
 * The design-system wizard — S4 (OD-010, OD-069, OD-075).
 *
 * The properties worth holding:
 *   - a created package is a *vendored-shaped* package written to the STORE
 *     (`<DATA_DIR>/design-systems`), which the catalog serves as an overlay
 *     over the vendored checkout — the wizard never writes into the repo;
 *   - a vendored id is never writable, an authored one only on request;
 *   - a token value can never break out of the `:root` declaration it lands in;
 *   - brand extraction measures fixture HTML/CSS with no network of any kind.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DaemonRequest } from '../src/http';
import { GET as fileGET } from '../src/routes/design-systems/_id/file/route';
import { GET as catalogGET } from '../src/routes/design-systems/route';
import {
  isValidSystemId,
  parseRootCustomProperties,
  slugify,
  validateTokens,
} from '../src/routes/design-systems/wizard/_lib';
import { POST as createPOST } from '../src/routes/design-systems/wizard/create-from-tokens/route';
import {
  extractBrandTokens,
  extractColors,
  extractFonts,
  isFetchableUrl,
  normalizeColor,
  scanCss,
  scanHtml,
} from '../src/routes/design-systems/wizard/extract-brand/route';

const GOOD_TOKENS: Record<string, string> = {
  bg: '#ffffff',
  surface: '#f7f7f7',
  fg: '#111111',
  muted: '#6a6a6a',
  border: '#dddddd',
  accent: '#ff385c',
  'font-display': '"Inter", system-ui, sans-serif',
  'font-body': '"Inter", system-ui, sans-serif',
};

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function create(input: unknown): Promise<Response> {
  return Promise.resolve(
    createPOST(
      new DaemonRequest('http://127.0.0.1/api/design-systems/wizard/create-from-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),
  );
}

// ─── Token validation ────────────────────────────────────────────────────────

describe('token validation', () => {
  it('accepts a complete token set', () => {
    expect(validateTokens(GOOD_TOKENS)).toEqual({ ok: true, errors: [] });
  });

  it('requires every token the catalog swatch strip and specimen read', () => {
    for (const missing of Object.keys(GOOD_TOKENS)) {
      const partial = { ...GOOD_TOKENS };
      delete partial[missing];
      const result = validateTokens(partial);
      expect([missing, result.ok]).toEqual([missing, false]);
      expect(result.errors.join(' ')).toContain(`--${missing}`);
    }
  });

  it('refuses a value that would break out of the declaration', () => {
    for (const attack of [
      '#fff; --accent: red',
      'red } body { display: none',
      'red</style><script>alert(1)</script>',
      'red\n--x: y',
    ]) {
      const result = validateTokens({ ...GOOD_TOKENS, accent: attack });
      expect([attack, result.ok]).toEqual([attack, false]);
    }
  });

  it('refuses a property name that is not a bare custom-property name', () => {
    for (const name of ['--accent', 'Accent', 'a b', 'accent!', '']) {
      expect([name, validateTokens({ ...GOOD_TOKENS, [name]: '#fff' }).ok]).toEqual([name, false]);
    }
  });

  it('refuses a non-object, an empty set and non-string values', () => {
    expect(validateTokens(null).ok).toBe(false);
    expect(validateTokens([]).ok).toBe(false);
    expect(validateTokens({}).ok).toBe(false);
    expect(validateTokens({ ...GOOD_TOKENS, accent: 42 }).ok).toBe(false);
  });

  it('slugifies a display name into a directory id', () => {
    expect(slugify('My Brand 2!')).toBe('my-brand-2');
    expect(slugify('  ---Hello---  ')).toBe('hello');
    expect(slugify('Ünï çodé 2!')).toBe('uni-code-2');
    expect(isValidSystemId(slugify('My Brand 2!'))).toBe(true);
  });

  it('rejects ids that are not bare safe slugs', () => {
    for (const id of ['../etc', 'a/b', '_schema', 'Upper', '', 'a'.repeat(49)]) {
      expect([id, isValidSystemId(id)]).toEqual([id, false]);
    }
  });

  it("reads the shared A2 fallbacks out of the schema's own defaults.css", () => {
    const props = parseRootCustomProperties(
      ':root {\n  /* c */ --radius-sm: 8px;\n  --space-1: 4px;\n}\nbody{--x:1}',
    );
    expect(props).toEqual({ 'radius-sm': '8px', 'space-1': '4px' });
  });
});

// ─── Layout writer + collisions ──────────────────────────────────────────────

describe('the layout writer', () => {
  /** The vendored catalog — read-only to the wizard. */
  let root: string;
  /** The store. The wizard writes to `<store>/design-systems`, never to `root`. */
  let store: string;
  let authoredRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ligma-ds-wizard-'));
    store = await mkdtemp(path.join(tmpdir(), 'ligma-ds-store-'));
    authoredRoot = path.join(store, 'design-systems');
    process.env.LIGMA_DESIGN_SYSTEMS_DIR = root;
    process.env.LIGMA_DATA_DIR = store;
  });

  afterEach(async () => {
    delete process.env.LIGMA_DESIGN_SYSTEMS_DIR;
    delete process.env.LIGMA_DATA_DIR;
    await rm(root, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  });

  it('writes the vendored triad into the STORE, never into the checkout', async () => {
    const res = await create({
      name: 'My Brand',
      category: 'Bespoke',
      blurb: 'Mine.',
      tokens: GOOD_TOKENS,
    });
    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({
      id: 'my-brand',
      files: ['manifest.json', 'DESIGN.md', 'tokens.css'],
    });

    // The vendored root is untouched: that is the whole point of the move.
    expect(await readdir(root)).toEqual([]);

    const manifest = JSON.parse(
      await readFile(path.join(authoredRoot, 'my-brand', 'manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 'od-design-system-project/v1',
      id: 'my-brand',
      name: 'My Brand',
      category: 'Bespoke',
      authored: true,
      files: { design: 'DESIGN.md', tokens: 'tokens.css' },
    });

    const css = await readFile(path.join(authoredRoot, 'my-brand', 'tokens.css'), 'utf-8');
    expect(css).toContain('--accent: #ff385c;');
    // Filled from design-systems/_schema/defaults.css, not re-typed here.
    expect(css).toContain('--radius-sm:');
    expect(css).toContain('--motion-fast:');
    expect(parseRootCustomProperties(css).accent).toBe('#ff385c');

    const design = await readFile(path.join(authoredRoot, 'my-brand', 'DESIGN.md'), 'utf-8');
    expect(design.startsWith('# Design System — My Brand')).toBe(true);
    expect(design).toContain('> Category: Bespoke');
    expect(design).toContain('overwrites these files in place');
  });

  it('is served by the catalog route as an overlay, marked authored', async () => {
    await create({ name: 'My Brand', category: 'Bespoke', blurb: 'Mine.', tokens: GOOD_TOKENS });

    const list = await body<{ systems: unknown[] }>(
      await catalogGET(new DaemonRequest('http://127.0.0.1/api/design-systems')),
    );
    expect(list.systems).toEqual([
      expect.objectContaining({
        id: 'my-brand',
        name: 'My Brand',
        category: 'Bespoke',
        blurb: 'Mine.',
        authored: true,
        swatches: expect.objectContaining({ accent: '#ff385c', bg: '#ffffff' }),
      }),
    ]);

    const detail = await body<{ tokensCss: string; design: string }>(
      await catalogGET(new DaemonRequest('http://127.0.0.1/api/design-systems?id=my-brand')),
    );
    expect(detail.tokensCss).toContain('--accent: #ff385c;');
    expect(detail.design).toContain('# Design System — My Brand');
  });

  it("serves both roots as one list, and both roots' files", async () => {
    // A vendored package the wizard can only read…
    await mkdir(path.join(root, 'vendored-one'), { recursive: true });
    await writeFile(
      path.join(root, 'vendored-one', 'manifest.json'),
      JSON.stringify({ id: 'vendored-one', name: 'Vendored One', category: 'Bundled' }),
    );
    await writeFile(
      path.join(root, 'vendored-one', 'tokens.css'),
      ':root { --accent: #123456; }\n',
    );
    // …alongside one it wrote.
    await create({ name: 'My Brand', category: 'Bespoke', blurb: 'Mine.', tokens: GOOD_TOKENS });

    const list = await body<{ systems: Array<{ id: string; authored: boolean }> }>(
      await catalogGET(new DaemonRequest('http://127.0.0.1/api/design-systems')),
    );
    expect(list.systems.map((s) => [s.id, s.authored])).toEqual([
      ['my-brand', true],
      ['vendored-one', false],
    ]);

    // Detail resolves out of whichever root holds the id.
    expect(
      (
        await body<{ authored: boolean; tokensCss: string }>(
          await catalogGET(
            new DaemonRequest('http://127.0.0.1/api/design-systems?id=vendored-one'),
          ),
        )
      ).tokensCss,
    ).toContain('#123456');

    // …and so does the byte-serving file route.
    const file = (id: string, rel: string): Promise<Response> =>
      Promise.resolve(
        fileGET(new DaemonRequest(`http://127.0.0.1/api/design-systems/${id}/file?path=${rel}`), {
          params: Promise.resolve({ id }),
        }),
      );
    expect((await file('vendored-one', 'tokens.css')).status).toBe(200);
    const authoredFile = await file('my-brand', 'tokens.css');
    expect(authoredFile.status).toBe(200);
    expect(await authoredFile.text()).toContain('--accent: #ff385c;');
    expect((await file('no-such-system', 'tokens.css')).status).toBe(404);
  });

  it('refuses to overwrite a vendored package, flag or no flag', async () => {
    await mkdir(path.join(root, 'airbnb'), { recursive: true });
    await writeFile(
      path.join(root, 'airbnb', 'manifest.json'),
      JSON.stringify({ id: 'airbnb', name: 'Airbnb', source: { type: 'bundled' } }),
    );

    for (const overwrite of [undefined, true]) {
      const res = await create({
        name: 'Airbnb',
        tokens: GOOD_TOKENS,
        ...(overwrite ? { overwrite } : {}),
      });
      expect([overwrite, res.status]).toEqual([overwrite, 409]);
      expect((await body<{ error: string }>(res)).error).toContain('vendored');
    }
    // Untouched.
    const untouched = JSON.parse(
      await readFile(path.join(root, 'airbnb', 'manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(untouched.authored).toBeUndefined();
  });

  it('treats a manifest-less legacy folder as vendored too', async () => {
    await mkdir(path.join(root, 'legacy'), { recursive: true });
    await writeFile(path.join(root, 'legacy', 'DESIGN.md'), '# Legacy\n');
    const res = await create({ name: 'Legacy', tokens: GOOD_TOKENS, overwrite: true });
    expect(res.status).toBe(409);
  });

  it('needs an explicit overwrite to replace an authored package', async () => {
    await create({ name: 'My Brand', tokens: GOOD_TOKENS });

    const refused = await create({ name: 'My Brand', tokens: GOOD_TOKENS });
    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({ overwritable: true });

    const replaced = await create({
      name: 'My Brand',
      tokens: { ...GOOD_TOKENS, accent: '#00aa55' },
      overwrite: true,
    });
    expect(replaced.status).toBe(201);
    expect(await body(replaced)).toMatchObject({ replaced: true });
    expect(await readFile(path.join(authoredRoot, 'my-brand', 'tokens.css'), 'utf-8')).toContain(
      '--accent: #00aa55;',
    );
  });

  it('400s an unusable name and an invalid token set before writing anything', async () => {
    expect((await create({ name: '!!!', tokens: GOOD_TOKENS })).status).toBe(400);
    expect((await create({ name: 'Ok', id: '../escape', tokens: GOOD_TOKENS })).status).toBe(400);
    const bad = await create({ name: 'Ok', tokens: { ...GOOD_TOKENS, accent: 'red; --x: y' } });
    expect(bad.status).toBe(400);
    expect((await body<{ details: string[] }>(bad)).details.join(' ')).toContain('--accent');
  });
});

// ─── Brand extraction (fixtures only, never the network) ─────────────────────

const FIXTURE_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="theme-color" content="#1a73e8">
<link rel="stylesheet" href="/assets/site.css">
<link rel="preload" href="/assets/not-a-sheet.css">
<style>
  /* --accent: #ff0000; a commented-out colour must not count */
  :root {
    --brand-primary: #1a73e8;
    --paper: #ffffff;
    --ink: #1f1f1f;
  }
  body { background: #ffffff; color: #1f1f1f; font-family: "Söhne", Helvetica, sans-serif; }
  .card { background-color: rgb(247, 247, 247); border: 1px solid hsl(0, 0%, 87%); }
  .ghost { color: rgba(0, 0, 0, 0.02); }
  @media (min-width: 40rem) {
    .cta { background: var(--brand-primary); color: #ffffff; }
  }
  @font-face { font-family: "Söhne"; src: url(/s.woff2); }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; }
</style>
</head>
<body style="background:#ffffff">
  <h1 class="hero title" style="font-family: 'Tiempos Text', Georgia, serif; color:#1f1f1f">Hi</h1>
</body></html>`;

const FIXTURE_CSS = `
.btn { background: #1a73e8; color: #ffffff; }
.btn:hover { background: #1557b0; }
.muted { color: #6a6a6a; }
`;

describe('brand extraction', () => {
  it("finds the page's stylesheets, inline CSS and theme colour", () => {
    const page = scanHtml(FIXTURE_HTML, 'https://example.com/');
    expect(page.themeColor).toBe('#1a73e8');
    // Only rel=stylesheet, resolved absolute; rel=preload is not a stylesheet.
    expect(page.stylesheets).toEqual(['https://example.com/assets/site.css']);
    // `style=` attributes survive with a synthetic selector carrying the classes.
    expect(page.css).toContain(
      "h1.hero.title{font-family: 'Tiempos Text', Georgia, serif; color:#1f1f1f}",
    );
  });

  it('reads declarations out of at-rule bodies rather than skipping them', () => {
    const declarations = scanCss('@media (min-width: 40rem){ .cta { color: #abcdef } }');
    expect(declarations).toEqual([{ selector: '.cta', property: 'color', value: '#abcdef' }]);
  });

  it('normalises the colour syntaxes a real page ships, and only those', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc');
    expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeColor('#aabbccff')).toBe('#aabbcc');
    expect(normalizeColor('rgb(26, 115, 232)')).toBe('#1a73e8');
    expect(normalizeColor('rgb(26 115 232 / 80%)')).toBe('#1a73e8');
    expect(normalizeColor('hsl(0, 0%, 100%)')).toBe('#ffffff');
    // Near-transparent is not a colour anyone saw.
    expect(normalizeColor('rgba(0, 0, 0, 0.02)')).toBeNull();
    // Not resolved here — deliberately, rather than guessed at.
    expect(normalizeColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(normalizeColor('var(--brand)')).toBeNull();
    expect(normalizeColor('rebeccapurple')).toBeNull();
  });

  it('ranks colours with the source each came from', () => {
    const colors = extractColors(scanCss(scanHtml(FIXTURE_HTML, 'https://example.com/').css));
    const brand = colors.find((c) => c.hex === '#1a73e8');
    expect(brand?.sources).toContain('var:--brand-primary');
    expect(colors.map((c) => c.hex)).toContain('#f7f7f7');
    // The commented-out red and the near-transparent black never became candidates.
    expect(colors.map((c) => c.hex)).not.toContain('#ff0000');
    expect(colors.map((c) => c.hex)).not.toContain('#000000');
  });

  it('takes the first non-generic family of each stack and ignores icon faces', () => {
    const { fonts, faceFamilies } = extractFonts(
      scanCss(scanHtml(FIXTURE_HTML, 'https://example.com/').css),
    );
    const families = fonts.map((f) => f.family);
    expect(families).toContain('Söhne');
    expect(families).toContain('JetBrains Mono');
    expect(families).toContain('Tiempos Text');
    expect(families).not.toContain('Helvetica');
    expect(families).not.toContain('sans-serif');
    expect(faceFamilies).toEqual(['Söhne']);
    expect(extractFonts(scanCss('.i { font-family: "Material Icons", sans-serif }')).fonts).toEqual(
      [],
    );
  });

  it('proposes a token set the create route will accept', () => {
    const extraction = extractBrandTokens(FIXTURE_HTML, 'https://example.com/', FIXTURE_CSS);
    expect(validateTokens(extraction.tokens).ok).toBe(true);
    expect(extraction.tokens.bg).toBe('#ffffff');
    expect(extraction.tokens.fg).toBe('#1f1f1f');
    // The declared theme-color wins the accent when it is chromatic.
    expect(extraction.tokens.accent).toBe('#1a73e8');
    expect(extraction.tokens['accent-on']).toBe('#ffffff');
    // Serif wins display, the next family takes body, mono is separate.
    expect(extraction.tokens['font-display']).toContain('Tiempos Text');
    expect(extraction.tokens['font-mono']).toContain('JetBrains Mono');
    expect(extraction.themeColor).toBe('#1a73e8');
    expect(extraction.notes.join(' ')).toContain('theme-color');
    expect(extraction.notes.join(' ')).toContain('_schema/defaults.css');
  });

  it('flips the neutral ends on a dark-cast page', () => {
    const dark = `<html><head><style>
      body { background: #0b0b0b; color: #f2f2f2 }
      .a { background: #0b0b0b } .b { background: #0b0b0b } .c { color: #f2f2f2 }
      .d { background: #0b0b0b } .e { background: #0b0b0b }
    </style></head><body></body></html>`;
    const extraction = extractBrandTokens(dark, 'https://example.com/');
    expect(extraction.tokens.bg).toBe('#0b0b0b');
    expect(extraction.tokens.fg).toBe('#f2f2f2');
  });

  it('says so rather than inventing values when a page publishes nothing', () => {
    const extraction = extractBrandTokens(
      '<html><body>plain</body></html>',
      'https://example.com/',
    );
    expect(validateTokens(extraction.tokens).ok).toBe(true);
    expect(extraction.colors).toEqual([]);
    expect(extraction.notes.join(' ')).toContain('inferred');
    expect(extraction.notes.join(' ')).toContain('No chromatic colour');
    expect(extraction.tokens['font-display']).toBe('system-ui, -apple-system, sans-serif');
  });

  it('refuses everything but a public http(s) URL', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://router.local/',
      'not a url',
    ]) {
      expect([url, isFetchableUrl(url)]).toEqual([url, false]);
    }
    expect(isFetchableUrl('https://example.com/')).toBe(true);
    expect(isFetchableUrl('http://172.32.0.1/')).toBe(true);
  });
});

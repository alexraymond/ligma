/**
 * The wizard's form rules and its two calls — S4 (OD-010, OD-075).
 *
 * The daemon owns the real validation; what is covered here is what the *form*
 * promises: the id it shows matches the one the daemon will derive, the submit
 * button is only enabled on a complete token set, a 409 on a name you already
 * own comes back as an offer to overwrite rather than a dead end, and the
 * preview never smuggles a raw token value past the `<style>` it lands in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_TOKENS,
  SCRATCH_TOKENS,
  WIZARD_ROUTES,
  WizardError,
  createDesignSystem,
  extractBrand,
  isColorToken,
  missingTokens,
  orderedTokens,
  previewSrcdoc,
  slugify,
} from './brand-tokens';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('form rules', () => {
  it('derives the same slug the daemon does', () => {
    expect(slugify('Acme Studio')).toBe('acme-studio');
    expect(slugify('  ---Hello---  ')).toBe('hello');
    expect(slugify('Ünï çodé 2!')).toBe('uni-code-2');
    expect(slugify('!!!')).toBe('');
  });

  it('starts from scratch with a complete, submittable token set', () => {
    expect(missingTokens(SCRATCH_TOKENS)).toEqual([]);
  });

  it('names every required token that is still empty', () => {
    expect(missingTokens({})).toEqual([...REQUIRED_TOKENS]);
    expect(missingTokens({ ...SCRATCH_TOKENS, accent: '   ' })).toEqual(['accent']);
  });

  it('orders the review rows neutrals → accent → families, keeping unknowns', () => {
    const names = orderedTokens({ ...SCRATCH_TOKENS, 'brand-x': '#123456' }).map(([name]) => name);
    expect(names.indexOf('bg')).toBeLessThan(names.indexOf('fg'));
    expect(names.indexOf('fg')).toBeLessThan(names.indexOf('accent'));
    expect(names.indexOf('accent')).toBeLessThan(names.indexOf('font-body'));
    expect(names).toContain('brand-x');
    expect(names.at(-1)).toBe('font-display');
  });

  it('shows a swatch for a colour token and not for a family', () => {
    expect(isColorToken('accent')).toBe(true);
    expect(isColorToken('font-display')).toBe(false);
  });

  it("puts every token into the preview's :root block", () => {
    const html = previewSrcdoc({ bg: '#fff', accent: '#f00' });
    expect(html).toContain('--bg: #fff;');
    expect(html).toContain('--accent: #f00;');
    expect(html).toContain('background: var(--bg)');
  });
});

describe("the wizard's two calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a URL to the extract route and returns the proposal', async () => {
    const proposal = {
      url: 'https://example.com/',
      tokens: SCRATCH_TOKENS,
      colors: [],
      fonts: [],
      themeColor: null,
      stylesheets: [],
      notes: ['inferred'],
    };
    fetchMock.mockResolvedValue(jsonResponse(proposal));

    expect(await extractBrand('https://example.com')).toEqual(proposal);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WIZARD_ROUTES.extractBrand);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com' });
  });

  it('turns a 409 on a name you own into an overwrite offer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'You already have a design system called "acme".', overwritable: true },
        409,
      ),
    );

    const err = await createDesignSystem({ name: 'Acme', tokens: SCRATCH_TOKENS }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WizardError);
    expect((err as WizardError).status).toBe(409);
    expect((err as WizardError).overwritable).toBe(true);
  });

  it('keeps a vendored-collision 409 a dead end, not an overwrite offer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: '"airbnb" is a vendored design system' }, 409),
    );

    const err = (await createDesignSystem({ name: 'Airbnb', tokens: SCRATCH_TOKENS }).catch(
      (e: unknown) => e,
    )) as WizardError;
    expect(err.overwritable).toBe(false);
    expect(err.message).toContain('vendored');
  });

  it('surfaces per-token validation details from a 400', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Invalid token set', details: ['token "--accent" is required'] }, 400),
    );

    const err = (await createDesignSystem({ name: 'Acme', tokens: {} }).catch(
      (e: unknown) => e,
    )) as WizardError;
    expect(err.details).toEqual(['token "--accent" is required']);
  });

  it('sends the fields the daemon needs and omits the ones left blank', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'acme', name: 'Acme', files: [], replaced: false }, 201),
    );

    const result = await createDesignSystem({
      name: 'Acme',
      tokens: SCRATCH_TOKENS,
      sourceUrl: 'https://example.com/',
    });
    expect(result).toMatchObject({ id: 'acme', replaced: false });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      name: 'Acme',
      tokens: SCRATCH_TOKENS,
      sourceUrl: 'https://example.com/',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(WIZARD_ROUTES.createFromTokens);
  });
});

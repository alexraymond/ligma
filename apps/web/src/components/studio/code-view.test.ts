import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_BYTES, languageForPath, shouldPlainRender } from './code-view';

describe('languageForPath', () => {
  it('maps known extensions to a shiki language id', () => {
    expect(languageForPath('index.html')).toBe('html');
    expect(languageForPath('styles/app.css')).toBe('css');
    expect(languageForPath('src/Widget.tsx')).toBe('tsx');
    expect(languageForPath('data.json')).toBe('json');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageForPath('README.MD')).toBe('markdown');
  });

  it('returns empty for an unknown or missing extension', () => {
    expect(languageForPath('Makefile')).toBe('');
    expect(languageForPath('bin/tool.exe')).toBe('');
  });
});

describe('shouldPlainRender', () => {
  it('is false under the highlight size ceiling', () => {
    expect(shouldPlainRender('a'.repeat(100))).toBe(false);
  });

  it('is true once a file exceeds the ceiling', () => {
    expect(shouldPlainRender('a'.repeat(MAX_HIGHLIGHT_BYTES + 1))).toBe(true);
  });
});

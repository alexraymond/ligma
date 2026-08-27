import { describe, expect, it } from 'vitest';
import { explainExportError, exportErrorCode } from './export-error-code';

describe('exportErrorCode', () => {
  it('reads the typed code off the thrown error', () => {
    expect(
      exportErrorCode(Object.assign(new Error('no chrome'), { code: 'EXPORTER_NO_CHROME' })),
    ).toBe('EXPORTER_NO_CHROME');
  });

  it('falls back to UNKNOWN when the error carries no code', () => {
    expect(exportErrorCode(new Error('boom'))).toBe('UNKNOWN');
    expect(exportErrorCode('boom')).toBe('UNKNOWN');
    expect(exportErrorCode(null)).toBe('UNKNOWN');
  });

  it('ignores a non-string code', () => {
    expect(exportErrorCode(Object.assign(new Error('boom'), { code: 500 }))).toBe('UNKNOWN');
  });
});

describe('explainExportError', () => {
  it('explains a known EXPORTER_* code in plain language', () => {
    expect(explainExportError('EXPORTER_NO_CHROME')).toMatch(/chrome/i);
  });

  it('has a generic fallback for an unrecognized code', () => {
    expect(explainExportError('SOMETHING_NEW')).toMatch(/unrecognized/i);
  });
});

import { CodesignError } from '@ligma/shared';
import { describe, expect, it } from 'vitest';
import { parseMultiFileRequest, parseRequest } from './exporter-ipc';

describe('parseRequest', () => {
  it('rejects a null payload with IPC_BAD_INPUT', () => {
    expect(() => parseRequest(null)).toThrow(CodesignError);
    expect(() => parseRequest(null)).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects an unknown format with EXPORTER_UNKNOWN', () => {
    expect(() => parseRequest({ format: 'docx', htmlContent: '<p>hi</p>' })).toThrowError(
      expect.objectContaining({ code: 'EXPORTER_UNKNOWN' }),
    );
  });

  it('rejects an empty htmlContent with IPC_BAD_INPUT', () => {
    expect(() => parseRequest({ format: 'pdf', htmlContent: '' })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('accepts a valid pdf request', () => {
    const result = parseRequest({
      format: 'pdf',
      htmlContent: '<html/>',
      defaultFilename: 'report.pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.htmlContent).toBe('<html/>');
    expect(result.defaultFilename).toBe('report.pdf');
  });
});

describe('parseMultiFileRequest', () => {
  it('rejects a null payload', () => {
    expect(() => parseMultiFileRequest(null)).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects a payload missing schemaVersion', () => {
    expect(() => parseMultiFileRequest({ entries: [] })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects an empty entries array', () => {
    expect(() => parseMultiFileRequest({ schemaVersion: 1, entries: [] })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects entries with empty path or non-string content', () => {
    expect(() =>
      parseMultiFileRequest({
        schemaVersion: 1,
        entries: [{ path: '', content: 'x' }],
      }),
    ).toThrow(CodesignError);
    expect(() =>
      parseMultiFileRequest({
        schemaVersion: 1,
        entries: [{ path: 'a.html', content: 42 }],
      }),
    ).toThrow(CodesignError);
  });

  it('accepts a valid multi-file request and threads defaultFilename', () => {
    const result = parseMultiFileRequest({
      schemaVersion: 1,
      entries: [
        { path: 'index.html', content: '<a/>' },
        { path: 'dashboard.html', content: '<b/>' },
      ],
      defaultFilename: 'my-project.zip',
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ path: 'index.html', content: '<a/>' });
    expect(result.defaultFilename).toBe('my-project.zip');
  });
});

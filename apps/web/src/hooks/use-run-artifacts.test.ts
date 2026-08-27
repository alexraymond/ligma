import { describe, expect, it } from 'vitest';
import { classifyArtifactResponse } from './use-run-artifacts';

// A run without a captured prompt/changes is not an error — the routes 404,
// and this must map to `notRecorded`, never to `error` ("absent ≠ empty").
describe('classifyArtifactResponse', () => {
  it('maps a 404 to notRecorded, not error', () => {
    expect(classifyArtifactResponse(404, false, null)).toEqual({
      data: null,
      error: null,
      notRecorded: true,
    });
  });

  it('maps a successful read to data, with notRecorded false', () => {
    const body = { prompt: 'build the thing' };
    expect(classifyArtifactResponse(200, true, body)).toEqual({
      data: body,
      error: null,
      notRecorded: false,
    });
  });

  it('maps any other failure to an error, distinct from notRecorded', () => {
    const result = classifyArtifactResponse(500, false, null);
    expect(result.notRecorded).toBe(false);
    expect(result.error).toContain('500');
    expect(result.data).toBeNull();
  });
});

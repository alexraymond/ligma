import { describe, expect, it } from 'vitest';
import { verificationRunsQuery } from './use-verification-runs';

// F1: Verify's evidence went missing once 50 workspace-wide runs existed,
// because the client never told the daemon which project it wanted. This
// pins down that the URL the hook builds actually carries the filters.
describe('verificationRunsQuery', () => {
  it('builds an unfiltered URL when neither id is given', () => {
    expect(verificationRunsQuery()).toBe('/api/verification-runs');
  });

  it('adds taskId alone', () => {
    expect(verificationRunsQuery('task_1')).toBe('/api/verification-runs?taskId=task_1');
  });

  it('adds projectId alone', () => {
    expect(verificationRunsQuery(undefined, 'proj_1')).toBe(
      '/api/verification-runs?projectId=proj_1',
    );
  });

  it('carries both filters together', () => {
    const url = verificationRunsQuery('task_1', 'proj_1');
    expect(url).toBe('/api/verification-runs?taskId=task_1&projectId=proj_1');
  });

  it('URL-encodes ids with special characters', () => {
    const url = verificationRunsQuery(undefined, 'proj a/b');
    expect(url).toBe('/api/verification-runs?projectId=proj+a%2Fb');
  });
});

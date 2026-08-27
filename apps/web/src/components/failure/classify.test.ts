import { describe, expect, it } from 'vitest';
import {
  classifyAdoptionStatus,
  classifyBootStatus,
  classifyCause,
  classifyCritiqueStatus,
  classifyInvalidReport,
  classifyManifestStatus,
  classifyOutcome,
  classifyPreflightCheck,
  classifyRunStatus,
  classifyStopReason,
} from './classify';

describe('classifyRunStatus', () => {
  it('maps deferred to the calm class', () => {
    expect(classifyRunStatus('deferred')).toBe('deferred');
  });

  it('maps failed and timeout to harness — a run malfunction, never a product defect', () => {
    expect(classifyRunStatus('failed')).toBe('harness');
    expect(classifyRunStatus('timeout')).toBe('harness');
  });

  it('is not a failure while running or completed', () => {
    expect(classifyRunStatus('running')).toBeNull();
    expect(classifyRunStatus('completed')).toBeNull();
  });
});

describe('classifyOutcome', () => {
  it("only 'error' is a harness class — 'failed' is a real verdict, not a card", () => {
    expect(classifyOutcome('error')).toBe('harness');
    expect(classifyOutcome('failed')).toBeNull();
    expect(classifyOutcome('passed')).toBeNull();
  });
});

describe('classifyManifestStatus', () => {
  it("classifies only 'error'", () => {
    expect(classifyManifestStatus('error')).toBe('harness');
    expect(classifyManifestStatus('running')).toBeNull();
    expect(classifyManifestStatus('complete')).toBeNull();
  });
});

describe('classifyAdoptionStatus', () => {
  // The env class, not the harness one: what fails is standing the repo up, and
  // the fix is the boot recipe — which is the action the `boot` card offers.
  it("classifies only 'error', as an environment failure", () => {
    expect(classifyAdoptionStatus('error')).toBe('boot');
    expect(classifyAdoptionStatus('awaiting-review')).toBeNull();
    expect(classifyAdoptionStatus('applied')).toBeNull();
    expect(classifyAdoptionStatus('running')).toBeNull();
  });
});

describe('classifyCritiqueStatus', () => {
  it("classifies only 'error'", () => {
    expect(classifyCritiqueStatus('error')).toBe('harness');
    expect(classifyCritiqueStatus('scored')).toBeNull();
    expect(classifyCritiqueStatus('idle')).toBeNull();
    expect(classifyCritiqueStatus('running')).toBeNull();
    expect(classifyCritiqueStatus('interrupted')).toBeNull();
  });
});

describe('classifyStopReason', () => {
  it("classifies only 'error'", () => {
    expect(classifyStopReason('error')).toBe('harness');
    expect(classifyStopReason('stop')).toBeNull();
    expect(classifyStopReason('aborted')).toBeNull();
    expect(classifyStopReason('max_turns')).toBeNull();
  });
});

describe('classifyInvalidReport', () => {
  it('an invalid report is a parse failure', () => {
    expect(classifyInvalidReport(true)).toBe('parse');
    expect(classifyInvalidReport(false)).toBeNull();
  });
});

describe('classifyPreflightCheck', () => {
  it('only a blocking fail is a boot failure', () => {
    expect(classifyPreflightCheck({ status: 'fail', severity: 'blocking' })).toBe('boot');
  });

  it('a non-blocking fail is not a card — it does not stop anything', () => {
    expect(classifyPreflightCheck({ status: 'fail', severity: 'warning' })).toBeNull();
    expect(classifyPreflightCheck({ status: 'fail', severity: 'info' })).toBeNull();
  });

  it('a passing or warning check is not a failure', () => {
    expect(classifyPreflightCheck({ status: 'pass', severity: 'blocking' })).toBeNull();
    expect(classifyPreflightCheck({ status: 'warning', severity: 'blocking' })).toBeNull();
  });
});

describe('classifyBootStatus', () => {
  it('missing or invalid boot recipes classify as boot failures', () => {
    expect(classifyBootStatus('missing')).toBe('boot');
    expect(classifyBootStatus('invalid')).toBe('boot');
  });

  it('ready is not a failure', () => {
    expect(classifyBootStatus('ready')).toBeNull();
  });
});

describe('classifyCause', () => {
  it("renames the governor's rate-limit to the calm deferred card", () => {
    // A promote preview the governor held back is a queue, not a fault — an
    // alarming red card there is what d1's personas needed least.
    expect(classifyCause('rate-limit')).toBe('deferred');
  });

  it('renames env to boot — the recipe is what recovers it', () => {
    expect(classifyCause('env')).toBe('boot');
  });

  it('passes the causes that are already the same word straight through', () => {
    expect(classifyCause('auth')).toBe('auth');
    expect(classifyCause('backend')).toBe('backend');
    expect(classifyCause('parse')).toBe('parse');
    expect(classifyCause('harness')).toBe('harness');
  });

  it('an unclassified failure is unknown, never dressed up as a classified one', () => {
    expect(classifyCause(null)).toBe('unknown');
    expect(classifyCause(undefined)).toBe('unknown');
  });
});

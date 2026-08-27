import { describe, expect, it } from 'vitest';
import { formatAbsoluteDate, formatDateTime, formatRelativeTime } from './time';

const NOW = new Date('2026-08-12T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('says just now under a minute', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
  });

  it('counts minutes', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
  });

  it('counts hours', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago');
  });

  it('counts days under the weekly cutoff', () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago');
  });

  it('falls back to an absolute date past the weekly cutoff', () => {
    const iso = new Date(NOW - 10 * 86_400_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe(formatAbsoluteDate(iso, NOW));
  });

  it('falls back to an absolute date for a future timestamp', () => {
    const iso = new Date(NOW + 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe(formatAbsoluteDate(iso, NOW));
  });

  it('never renders Invalid Date for unparsable input', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('unknown');
  });
});

describe('formatAbsoluteDate', () => {
  it('omits the year for a date in the current year', () => {
    expect(formatAbsoluteDate('2026-08-01T00:00:00.000Z', NOW)).toBe('Aug 1');
  });

  it('includes the year once the date crosses a year boundary (walkthrough: day headers with no year)', () => {
    expect(formatAbsoluteDate('2025-02-27T00:00:00.000Z', NOW)).toBe('Feb 27, 2025');
  });

  it('never renders Invalid Date for unparsable input', () => {
    expect(formatAbsoluteDate('not-a-date', NOW)).toBe('unknown date');
  });
});

describe('formatDateTime', () => {
  it('combines the absolute date with a time', () => {
    expect(formatDateTime('2026-08-01T14:30:00.000Z', NOW)).toMatch(
      /^Aug 1, \d{1,2}:\d{2}\s?(AM|PM)?$/i,
    );
  });

  it('never renders Invalid Date for unparsable input', () => {
    expect(formatDateTime('not-a-date', NOW)).toBe('unknown time');
  });
});

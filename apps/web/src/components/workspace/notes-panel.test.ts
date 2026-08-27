import { describe, expect, it } from 'vitest';
import { formatNoteTimestamp } from './notes-panel';

describe('formatNoteTimestamp', () => {
  it('renders a short, human date + time', () => {
    const formatted = formatNoteTimestamp('2026-03-05T14:30:00.000Z');
    // Locale/timezone-dependent formatting (day-month order, AM/PM) — assert
    // the pieces are present, not an exact string.
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/5/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

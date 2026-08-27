/**
 * Activity page's pure rendering-data helpers (M6/M7 — raw internals as user
 * copy): joining a raw `task_…` id in `summary` back to the task's real
 * title, and turning an agent SDK JSON transcript in `details` into a human
 * line with the raw payload behind a disclosure instead of as an unwrapped
 * 4,019px line.
 */
import { describe, expect, it } from 'vitest';
import { extractSdkResultText, joinTaskTitle, summarizeDetails } from './activity-summary';

describe('joinTaskTitle', () => {
  it("leaves a taskless event's summary untouched", () => {
    expect(joinTaskTitle({ summary: 'Answered: pick a color', taskId: null }, new Map())).toBe(
      'Answered: pick a color',
    );
  });

  it("replaces the raw id with the task's current title when it can find one", () => {
    const titleById = new Map([['task_y1459tiApf09', 'Design the campaign generator']]);
    expect(
      joinTaskTitle(
        { summary: 'Completed task: task_y1459tiApf09', taskId: 'task_y1459tiApf09' },
        titleById,
      ),
    ).toBe('Completed task: Design the campaign generator');
  });

  it('leaves the summary alone when the task no longer exists', () => {
    expect(
      joinTaskTitle({ summary: 'Completed task: task_gone', taskId: 'task_gone' }, new Map()),
    ).toBe('Completed task: task_gone');
  });

  it("leaves an already-good summary alone (the id isn't literally in it)", () => {
    const titleById = new Map([['task_1', 'Ship the feature']]);
    expect(
      joinTaskTitle(
        { summary: 'Task delegated to developer: Ship the feature', taskId: 'task_1' },
        titleById,
      ),
    ).toBe('Task delegated to developer: Ship the feature');
  });
});

describe('extractSdkResultText', () => {
  it('reads the trailing type:result entry out of an SDK transcript array', () => {
    const transcript = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
      { type: 'result', result: 'Delivered the design doc at docs/plan.md.' },
    ];
    expect(extractSdkResultText(transcript)).toBe('Delivered the design doc at docs/plan.md.');
  });

  it('reads a single {result} object', () => {
    expect(extractSdkResultText({ session_id: 's1', result: 'Done.' })).toBe('Done.');
  });

  it("falls back to the last assistant message's text when there is no result entry", () => {
    const transcript = [
      { type: 'system' },
      { type: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
    ];
    expect(extractSdkResultText(transcript)).toBe('final answer');
  });

  it('returns null when nothing in the structure is human-readable', () => {
    expect(extractSdkResultText([{ type: 'system', subtype: 'init' }])).toBeNull();
  });
});

describe('summarizeDetails', () => {
  it('is null for empty details', () => {
    expect(summarizeDetails('')).toBeNull();
    expect(summarizeDetails('   ')).toBeNull();
  });

  it('treats a short plain report as inline, not long', () => {
    const view = summarizeDetails('Marked as done by business-analyst.');
    expect(view).toEqual({
      long: false,
      preview: 'Marked as done by business-analyst.',
      full: 'Marked as done by business-analyst.',
      markdown: true,
    });
  });

  it('collapses a long markdown report behind a disclosure, rendered as markdown', () => {
    const body = `## Summary of What Was Accomplished\n\n${'x'.repeat(300)}`;
    const view = summarizeDetails(body);
    expect(view?.long).toBe(true);
    expect(view?.markdown).toBe(true);
    expect(view?.full).toBe(body);
  });

  it('extracts the result text from a JSON transcript instead of showing the raw array', () => {
    const transcript = JSON.stringify([
      { type: 'system', subtype: 'init', cwd: '/Users/alexraymond/ligma' },
      { type: 'result', result: 'All acceptance criteria pass.' },
    ]);
    const view = summarizeDetails(transcript);
    expect(view?.preview).toBe('All acceptance criteria pass.');
    expect(view?.markdown).toBe(true);
  });

  it('labels a transcript with nothing human-readable rather than dumping it as prose', () => {
    const transcript = JSON.stringify([{ type: 'system', subtype: 'init' }]);
    const view = summarizeDetails(transcript);
    expect(view?.markdown).toBe(false);
    expect(view?.long).toBe(true);
    expect(view?.full).toContain('"subtype": "init"');
  });

  it('falls back to wrapped raw text for a transcript truncated mid-object (invalid JSON)', () => {
    const truncated =
      '[{"type":"system","subtype":"init","cwd":"/Users/alexraymond/mission-control","tools":["Ta';
    const view = summarizeDetails(truncated);
    expect(view?.markdown).toBe(true);
    expect(view?.full).toBe(truncated);
  });
});

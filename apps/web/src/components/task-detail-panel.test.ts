// This vitest config runs node-only (no jsdom), so a real render of the panel
// isn't available here. Same spirit as `governor-card.test.ts`'s wiring
// proof: read the component source with fs and pin the structural facts a
// render would otherwise verify — that the three tabs exist, Log is the
// default (never auto-switched to Changes/Prompt), and a task with no runs
// gets an honest message instead of an empty tab strip.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './task-detail-panel.tsx'), 'utf-8');

describe('TaskDetailPanel — Changes · Log · Prompt tabs', () => {
  it('mounts a Tabs region with all three triggers', () => {
    expect(SOURCE).toContain('<TabsTrigger value="changes">');
    expect(SOURCE).toContain('<TabsTrigger value="log">');
    expect(SOURCE).toContain('<TabsTrigger value="prompt">');
  });

  it('defaults to Log, never Changes or Prompt', () => {
    expect(SOURCE).toContain('<Tabs defaultValue="log">');
  });

  it('Log tab content is the existing RunOutputSection, unchanged', () => {
    const logContentStart = SOURCE.indexOf('<TabsContent value="log">');
    expect(logContentStart).toBeGreaterThan(-1);
    const logContentEnd = SOURCE.indexOf('</TabsContent>', logContentStart);
    const logContent = SOURCE.slice(logContentStart, logContentEnd);
    expect(logContent).toContain('<RunOutputSection');
  });

  it('a task with no runs gets an honest message, not an empty tab strip', () => {
    expect(SOURCE).toContain('This task has no runs yet.');
    // The honest branch and the Tabs branch are mutually exclusive on `latestRun`.
    expect(SOURCE).toMatch(/latestRun\s*\?\s*\(?\s*<RunArtifactTabs/);
  });

  it("mounts the Outcome section, open by default — it answers 'did this work?'", () => {
    expect(SOURCE).toContain('<OutcomeSection task={task} />');
    // `useState(true)` inside OutcomeSection: the one section that must not
    // start collapsed.
    const start = SOURCE.indexOf('function OutcomeSection');
    expect(start).toBeGreaterThan(-1);
    expect(SOURCE.slice(start, start + 400)).toContain('useState(true)');
  });

  it('names a missing builder summary instead of rendering a polite blank', () => {
    expect(SOURCE).toContain('Builder returned no summary');
    expect(SOURCE).toContain('See the run output log');
    // The old fiction survives only in the comment explaining what it broke.
    expect(SOURCE.match(/No additional notes/g)).toHaveLength(1);
  });

  // H4: the most common parked state — three unanswered decisions — produced 413
  // daemon log lines and zero pixels. The reason is now carried on the outcome
  // and shown here, with the count that makes it actionable.
  it("renders the daemon's park reason through the shared failure card", () => {
    expect(SOURCE).toContain('failureClass="parked"');
    expect(SOURCE).toContain('detail={outcome.parkedReason}');
  });

  it('names the pending decision count and links somewhere they can be answered', () => {
    expect(SOURCE).toContain('outcome.pendingDecisions');
    expect(SOURCE).toMatch(/Answer \$\{outcome\.pendingDecisions\} pending decision/);
    expect(SOURCE).toContain("href: '/deck'");
  });

  it('badges a parked task in the collapsed header, so it is visible without opening', () => {
    const outcome = SOURCE.indexOf('function OutcomeSection');
    const start = SOURCE.indexOf('<CollapsibleTrigger', outcome);
    const end = SOURCE.indexOf('</CollapsibleTrigger>', start);
    expect(SOURCE.slice(start, end)).toContain('parked');
  });

  it('shows a governor deferral through the shared calm F5 card, not a bespoke one', () => {
    expect(SOURCE).toContain('failureClass="deferred"');
    expect(SOURCE).toContain('resumeAt={outcome.deferred.resumesAt}');
    expect(SOURCE).toContain('Artifacts written');
  });

  it('Changes and Prompt map their own 404 to an honest not-recorded message, not a blank pane', () => {
    expect(SOURCE).toContain('No changes recorded for this run.');
    expect(SOURCE).toContain('No prompt recorded (run predates phase 2).');
  });

  // W21: Escape used to close the panel unconditionally, discarding whatever
  // was mid-edit in the form — Escape is also how a Select dropdown closes
  // itself, so it fired far more often than "I want to leave".
  it('confirms before Escape discards an unsaved edit', () => {
    const start = SOURCE.indexOf('function handleKeyDown(e: KeyboardEvent)');
    const end = SOURCE.indexOf('document.addEventListener', start);
    const body = SOURCE.slice(start, end);
    expect(body).toContain('if (formDirty && !window.confirm(');
  });

  it('tracks dirtiness from the form itself, not a bespoke diff', () => {
    expect(SOURCE).toContain('onDirtyChange={setFormDirty}');
  });
});

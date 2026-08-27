// F7: the kill switch is file/CLI-only (owner decision, UX-REBUILD-BRIEF §2)
// — a stop a browser can reach is a stop an agent can un-press. This pins
// that the browser control stayed removed, without a jsdom render (this
// vitest config runs node-only) — reads the component source with fs, same
// spirit as other wiring proofs in this repo.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './governor-card.tsx'), 'utf-8');

describe('GovernorCard — kill switch has no browser control', () => {
  it('renders no checkbox bound to a killSwitch state', () => {
    expect(SOURCE).not.toContain('checked={killSwitch}');
    expect(SOURCE).not.toContain('setKillSwitch');
  });

  it('does not send a killSwitch key in the save payload', () => {
    const start = SOURCE.indexOf('governor: {');
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf('},', start);
    expect(end).toBeGreaterThan(start);
    const payload = SOURCE.slice(start, end);
    expect(payload).not.toContain('killSwitch');
  });

  it('keeps every read-only kill-switch surface', () => {
    expect(SOURCE).toContain('fileKilled');
    expect(SOURCE).toContain('governor-kill');
    expect(SOURCE).toContain('kill switch on');
  });
});

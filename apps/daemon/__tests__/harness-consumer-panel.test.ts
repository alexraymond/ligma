/**
 * The consumer panel: shape-aware selection, the naive-developer's tool grant,
 * and the structured output the new charters must produce.
 *
 * The load-bearing assertion is the grant. "The tester never sees source" is a
 * principle in a document until it is a deny rule on an argv, and the
 * naive-developer is the one charter that runs against a real checkout — so the
 * test walks it all the way down to what the CLI is actually told.
 */

import { describe, expect, it } from 'vitest';
import { buildArgs } from '../src/engine/runner';
import { panelRoster, panelTransports, transportRoster } from '../src/harness/panel';
import {
  type RunPersonaOptions,
  SOURCE_EXTENSIONS,
  buildPersonaPrompt,
  deniesSourceRead,
  parsePersonaOutput,
  personaToolGrant,
} from '../src/harness/personas';
import { buildRoster } from '../src/harness/run-verification';
import type { AcceptanceContract, PersonaCharter } from '../src/harness/types';

const contract: AcceptanceContract = {
  id: 'ctr_test',
  version: 1,
  taskId: null,
  productId: 'proj_x__jrn_y',
  title: 'Journey: install and use the CLI',
  baselineRunId: null,
  criteria: [
    {
      id: 'crit_goal',
      kind: 'criterion',
      text: 'a developer can install it',
      holdout: false,
      provenance: null,
    },
    {
      id: 'crit_1',
      kind: 'invariant',
      text: 'it never overwrites an existing file without asking',
      holdout: false,
      provenance: null,
    },
  ],
  createdAt: new Date().toISOString(),
  signature: null,
};

function promptFor(charter: PersonaCharter, transport: 'browser' | 'http' | 'pty' | 'fs'): string {
  const opts: RunPersonaOptions = {
    spec: { charter, name: `${charter}-1`, personaSeed: null, transport },
    runId: 'vrun_test',
    runDir: '/tmp/none',
    bridgeUrl: 'http://127.0.0.1:1/s/x/tok',
    productUrl: 'http://127.0.0.1:2',
    contract,
    goal: 'get the thing installed and produce one output',
    maxTurns: 10,
    timeoutMinutes: 5,
  };
  return buildPersonaPrompt(opts);
}

// ─── Tool grants ─────────────────────────────────────────────────────────────

describe("the naive-developer's tool grant", () => {
  const grant = personaToolGrant('naive-developer');

  it('gives it Bash and nothing else — the bridge is the product', () => {
    expect(grant.allowedTools).toEqual(['Bash']);
  });

  it("denies reading source, in the CLI's own permission machinery", () => {
    const args = buildArgs(
      {
        prompt: 'p',
        maxTurns: 4,
        timeoutMinutes: 5,
        skipPermissions: false,
        cwd: '/tmp',
        ...grant,
      },
      'claude',
    );
    const deny = args.slice(args.indexOf('--disallowedTools') + 1);
    expect(args).toContain('--disallowedTools');
    for (const ext of SOURCE_EXTENSIONS) expect(deny).toContain(`Read(**/*.${ext})`);
    // Searching source is seeing source.
    expect(deny).toContain('Grep(**)');
    expect(deny).toContain('Glob(**)');
  });

  it('still denies the compiled contract and the central baseline store', () => {
    expect(grant.disallowedTools!.some((r) => r.includes('contracts'))).toBe(true);
    expect(grant.disallowedTools!.some((r) => r.includes('projects'))).toBe(true);
  });

  it('classifies source and docs the way the deny rules are generated from', () => {
    for (const file of ['src/index.ts', 'app/main.py', 'lib/x.go', 'Cargo/build.rs', 'a/b/c.tsx']) {
      expect(deniesSourceRead(file)).toBe(true);
    }
    for (const file of ['README.md', 'docs/quickstart.md', 'CHANGELOG', 'notes.txt']) {
      expect(deniesSourceRead(file)).toBe(false);
    }
  });

  it("leaves every other charter's grant exactly as it was", () => {
    for (const charter of [
      'naive-user',
      'saboteur',
      'returning-user',
      'visual-critic',
      'spec-auditor',
    ] as const) {
      expect(personaToolGrant(charter)).toEqual({ allowedTools: ['Bash'] });
    }
  });
});

// ─── Shape-aware selection ───────────────────────────────────────────────────

describe('panel transports', () => {
  it('gives a UI project browser personas', () => {
    expect(panelTransports('ui', [], true)).toEqual(['browser']);
  });

  it('gives a headless project consumer personas — HTTP when it serves, terminal when it does not', () => {
    expect(panelTransports('headless', [], true)).toEqual(['http']);
    expect(panelTransports('headless', [], false)).toEqual(['pty']);
  });

  it('gives a mixed project both', () => {
    expect(panelTransports('mixed', [], true)).toEqual(['browser', 'http']);
    expect(panelTransports('mixed', [], false)).toEqual(['browser', 'pty']);
  });

  it("lets a journey's tags override the shape — a CLI journey is a CLI journey", () => {
    expect(panelTransports('mixed', ['cli'], true)).toEqual(['pty']);
    expect(panelTransports('ui', ['api'], true)).toEqual(['http']);
    expect(panelTransports('headless', ['ui'], true)).toEqual(['browser']);
  });

  it('takes every transport a journey is tagged with, once', () => {
    expect(panelTransports('headless', ['api', 'cli', 'http'], true)).toEqual(['http', 'pty']);
  });

  it('ignores tags that name no transport', () => {
    expect(panelTransports('headless', ['core', 'smoke'], true)).toEqual(['http']);
  });

  it('gives an artifact project the file transport, and nothing else', () => {
    expect(panelTransports('artifact', [], false)).toEqual(['fs']);
    // Even a project that somehow serves something: an artifact is judged by
    // what it contains, and there is no dev server to point a browser at.
    expect(panelTransports('artifact', [], true)).toEqual(['fs']);
  });

  it('does not let a tag send an artifact project to a surface it does not have', () => {
    expect(panelTransports('artifact', ['ui'], true)).toEqual(['fs']);
    expect(panelTransports('artifact', ['api', 'cli'], true)).toEqual(['fs']);
  });
});

describe('panel rosters', () => {
  it('staffs a browser panel with naive users', () => {
    expect(transportRoster('browser', { smoke: true }).map((s) => s.charter)).toEqual([
      'naive-user',
      'spec-auditor',
    ]);
  });

  it('staffs a headless panel with naive developers instead', () => {
    for (const transport of ['http', 'pty'] as const) {
      expect(transportRoster(transport, { smoke: true }).map((s) => s.charter)).toEqual([
        'naive-developer',
        'spec-auditor',
      ]);
    }
  });

  it('puts a saboteur on a headless acceptance panel, but no visual critic', () => {
    const charters = transportRoster('http', { smoke: false, naiveRuns: 2 }).map((s) => s.charter);
    expect(charters).toContain('saboteur');
    expect(charters).not.toContain('visual-critic');
  });

  it('keeps the browser acceptance panel exactly as it was', () => {
    expect(buildRoster(true, 3).map((s) => s.name)).toEqual(['naive-user-1', 'spec-auditor']);
    expect(buildRoster(false, 3).map((s) => s.name)).toEqual([
      'spec-auditor',
      'naive-user-1',
      'naive-user-2',
      'naive-user-3',
      'saboteur',
      'returning-user',
      'visual-critic',
    ]);
  });

  it('tags every persona with the transport it must drive', () => {
    expect(transportRoster('pty', { smoke: false }).every((s) => s.transport === 'pty')).toBe(true);
  });

  it('keeps evidence directory names unique when a run spans two transports', () => {
    const names = panelRoster(['browser', 'http'], { smoke: true }).map((s) => s.name);
    expect(names).toEqual([
      'naive-user-1-browser',
      'spec-auditor-browser',
      'naive-developer-1-http',
      'spec-auditor-http',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('does not rename anything on a single-transport run', () => {
    expect(panelRoster(['http'], { smoke: true }).map((s) => s.name)).toEqual([
      'naive-developer-1',
      'spec-auditor',
    ]);
  });

  /**
   * Two sessions per task instead of fifteen (H5). A paper cannot be sabotaged,
   * cannot be re-visited as a returning user, and has no craft for a visual
   * critic to judge — every one of those was a session spent on a question the
   * product could not answer.
   */
  it('staffs an artifact panel with the auditor first and one reader — and nothing else', () => {
    const charters = transportRoster('fs', { smoke: false, naiveRuns: 3 }).map((s) => s.charter);
    expect(charters).toEqual(['spec-auditor', 'naive-developer']);
    expect(transportRoster('fs', { smoke: false, naiveRuns: 3 })).toHaveLength(2);
  });

  it('smoke-tests an artifact with the auditor alone', () => {
    expect(transportRoster('fs', { smoke: true }).map((s) => s.name)).toEqual(['spec-auditor']);
  });
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

describe('transport-aware prompts', () => {
  it('teaches the HTTP persona the request action, not clicks', () => {
    const prompt = promptFor('naive-developer', 'http');
    expect(prompt).toContain('$B/request');
    expect(prompt).not.toContain('$B/click');
    expect(prompt).toContain('A 4xx or 5xx is NOT an error here');
  });

  it('teaches the terminal persona argv arrays and the docs action', () => {
    const prompt = promptFor('naive-developer', 'pty');
    expect(prompt).toContain('$B/run');
    expect(prompt).toContain('$B/docs');
    expect(prompt).toContain('`argv` is an ARRAY, never a shell string');
  });

  it('tells the naive-developer the documentation IS the interface', () => {
    const prompt = promptFor('naive-developer', 'pty');
    expect(prompt).toContain('the README is the only UI');
    expect(prompt).toContain('Follow the quickstart LITERALLY');
    // Doc rot is a behaviour, graded like one.
    expect(prompt).toMatch(/exits non-zero, is a `blocker`/);
  });

  it('teaches the artifact persona to read and cite, not to click or curl the product', () => {
    const prompt = promptFor('naive-developer', 'fs');
    expect(prompt).toContain('$B/list');
    expect(prompt).toContain('$B/read');
    expect(prompt).not.toContain('$B/click');
    expect(prompt).not.toContain('$B/goto');
    // Evidence by citation is the whole contract of this transport.
    expect(prompt).toContain('record');
    expect(prompt).toMatch(/quote|excerpt|cite/i);
  });

  it('tells the artifact persona it may run only the declared check', () => {
    const prompt = promptFor('spec-auditor', 'fs');
    expect(prompt).toContain('$B/run');
    expect(prompt).toMatch(/declared in boot\.json|the repo declared/);
  });

  it('gives the saboteur a playbook it can actually perform on its transport', () => {
    expect(promptFor('saboteur', 'http')).toContain('Malformed body');
    expect(promptFor('saboteur', 'pty')).toContain('Hostile arguments');
    expect(promptFor('saboteur', 'browser')).toContain('Double-submit');
    // And it still carries the contract's invariants, on every transport.
    for (const t of ['browser', 'http', 'pty'] as const) {
      expect(promptFor('saboteur', t)).toContain('never overwrites an existing file');
    }
  });

  it('asks the explorer for journeys and a confusion log', () => {
    const prompt = promptFor('explorer', 'browser');
    expect(prompt).toContain('"journeys"');
    expect(prompt).toContain('confusion log');
    expect(prompt).toContain('never a click script');
  });

  it('never leaks the contract to a charter that must discover the product', () => {
    for (const charter of ['naive-developer', 'explorer'] as const) {
      expect(promptFor(charter, 'pty')).not.toContain('crit_goal');
    }
  });
});

// ─── Structured output ───────────────────────────────────────────────────────

const envelope = (reply: string): string => JSON.stringify({ type: 'result', result: reply });
const fenced = (value: unknown): string =>
  `Here you go.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

describe('structured output per step', () => {
  it("parses a naive-developer's report the same way as any other charter", () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: false,
          wrongTurns: 2,
          findings: [
            {
              severity: 'blocker',
              summary: "the quickstart's `npm start` exits 127",
              evidence: ['personas/naive-developer-1/records/02-npm.json'],
              criterionId: null,
            },
          ],
        }),
      ),
      'naive-developer',
    );
    expect(parsed.goalAchieved).toBe(false);
    expect(parsed.wrongTurns).toBe(2);
    expect(parsed.findings[0].evidence).toEqual(['personas/naive-developer-1/records/02-npm.json']);
    expect(parsed.proposedJourneys).toBeNull();
  });

  it("takes an auditor's per-step results pointing at bridge records", () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: null,
          findings: [],
          criterionResults: [
            {
              criterionId: 'crit_1',
              status: 'met',
              evidence: ['personas/spec-auditor/records/01-POST-api-tasks.json'],
            },
          ],
        }),
      ),
      'spec-auditor',
    );
    expect(parsed.criterionResults).toEqual([
      {
        criterionId: 'crit_1',
        status: 'met',
        evidence: ['personas/spec-auditor/records/01-POST-api-tasks.json'],
      },
    ]);
  });

  it("parses the explorer's proposed journeys", () => {
    const parsed = parsePersonaOutput(
      envelope(
        fenced({
          goalAchieved: null,
          findings: [
            {
              severity: 'minor',
              summary: 'could not tell if it saved',
              evidence: [],
              criterionId: null,
            },
          ],
          journeys: [
            {
              title: 'Capture a thought',
              goal: 'get an idea in',
              steps: ['write it', 'find it'],
              tags: ['core'],
              rationale: 'saw a form',
            },
          ],
        }),
      ),
      'explorer',
    );
    expect(parsed.proposedJourneys).toEqual([
      {
        title: 'Capture a thought',
        goal: 'get an idea in',
        steps: ['write it', 'find it'],
        tags: ['core'],
        rationale: 'saw a form',
      },
    ]);
    // The confusion log is just findings — nothing new for the judge to learn.
    expect(parsed.findings).toHaveLength(1);
  });

  it('discards journeys claimed by a charter that is not the explorer', () => {
    const reply = envelope(
      fenced({ goalAchieved: true, findings: [], journeys: [{ title: 'x', goal: 'y' }] }),
    );
    expect(parsePersonaOutput(reply, 'naive-developer').proposedJourneys).toBeNull();
  });

  it('throws on a malformed journey rather than inventing one', () => {
    const reply = envelope(fenced({ findings: [], journeys: [{ title: 'x' }] }));
    expect(() => parsePersonaOutput(reply, 'explorer')).toThrow(/goal is empty/);
  });

  it('throws when there is no structured block at all — an invalid run is never a pass', () => {
    expect(() =>
      parsePersonaOutput(envelope('I could not get the CLI to run, sorry.'), 'naive-developer'),
    ).toThrow(/no fenced JSON block/);
  });
});

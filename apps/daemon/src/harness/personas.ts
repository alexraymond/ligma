/**
 * personas.ts — the persona panel: charters, prompts, and one claude -p spawn each.
 *
 * Every persona is a fresh session with no memory of the others. They get `Bash`
 * and nothing else — no Read, no Edit, no Write — and their cwd is an empty
 * sandbox under the run's evidence dir, never the repo. The only way they can
 * observe the product is by curling a bridge, which records what they actually
 * did. Which bridge depends on the transport: a browser for a UI, an HTTP client
 * for an API, a terminal for a CLI. The charters are transport-aware; everything
 * downstream of the report is not.
 *
 * Structured output is the contract: the reply must end with one fenced JSON
 * block. Parse failure or a non-zero exit ⇒ `invalid: true`, and an invalid run
 * is NEVER a pass (docs/history/CONTRACTS.md §5).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunFailureCause } from '@ligma/api';
import { denyRulesForRole, loadConfig } from '../engine/config';
import { AgentRunner, modelForBackend } from '../engine/runner';
import { enforcePromptLimit, scrubCredentials } from '../engine/security';
import type { BridgeTransport } from './bridge-server';
import { awaitClaimedSlot } from './spawn-slot';
import type {
  AcceptanceContract,
  PersonaCharter,
  PersonaCriterionResult,
  PersonaFinding,
  PersonaReport,
} from './types';

export type { BridgeTransport };

const SEVERITIES = new Set(['blocker', 'major', 'minor', 'note']);
const CRITERION_STATUSES = new Set(['met', 'not-met', 'not-tested']);

/** Distinct backgrounds so three naive users don't make the same three mistakes. */
export const NAIVE_SEEDS = [
  'You are a small-business owner who lives in spreadsheets and has never used a kanban board. You are impatient and you do not read documentation.',
  'You are a careful academic researcher. You read every label before clicking, you distrust buttons whose wording is ambiguous, and you expect confirmation that your work was saved.',
  'You are a developer in a hurry between meetings. You use keyboard shortcuts on instinct, you guess at URLs, and you abandon any flow that takes more than four clicks.',
];

/** Distinct backgrounds for the headless panel — same trick, different audience. */
export const DEVELOPER_SEEDS = [
  'You are a backend engineer evaluating this for work. You skim, you copy-paste the first code block you see, and you give up on anything that needs more than one page of setup.',
  'You are a careful open-source maintainer. You read the whole quickstart before running anything, you check exit codes, and you distrust a step that does not say what success looks like.',
];

export interface PersonaSpec {
  charter: PersonaCharter;
  /** Directory name under personas/ — unique per spawn (e.g. "naive-user-1"). */
  name: string;
  personaSeed: string | null;
  /** Which bridge this persona drives. Defaults to the browser. */
  transport?: BridgeTransport;
}

// ─── Tool grants ─────────────────────────────────────────────────────────────

/**
 * File kinds a tester must never read. "The tester never sees source" is a
 * principle (brief §4), and the naive-developer is the one charter that gets
 * anywhere near a checkout — so for it the principle is a deny rule, not a
 * request in a prompt.
 */
export const SOURCE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'rb',
  'java',
  'kt',
  'swift',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'scala',
  'ex',
  'exs',
  'sql',
  'vue',
  'svelte',
] as const;

/** True when the naive-developer's grant denies reading this path. */
export function deniesSourceRead(file: string): boolean {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  return (SOURCE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * What a charter may do, expressed in the CLI's own permission machinery.
 *
 * Every persona gets Bash and nothing else — the bridge is the product. The
 * naive-developer additionally carries explicit deny rules: it is the charter
 * whose whole job is "read the README of a real checkout and follow it", so the
 * one thing it must be unable to do is read the code that README describes.
 * Deny beats allow in the CLI, so these hold even if a future caller widens the
 * allow list.
 */
export function personaToolGrant(charter: PersonaCharter): {
  allowedTools: string[];
  disallowedTools?: string[];
} {
  if (charter !== 'naive-developer') return { allowedTools: ['Bash'] };
  return {
    allowedTools: ['Bash'],
    disallowedTools: [
      // The contracts and the central baseline store, same as every other spawn.
      ...denyRulesForRole(),
      ...SOURCE_EXTENSIONS.flatMap((ext) => [
        `Read(**/*.${ext})`,
        `Edit(**/*.${ext})`,
        `Write(**/*.${ext})`,
      ]),
      // Searching source is seeing source.
      'Grep(**)',
      'Glob(**)',
    ],
  };
}

export interface RunPersonaOptions {
  spec: PersonaSpec;
  runId: string;
  /** <data>/verification-runs/<runId> */
  runDir: string;
  /** Bridge session base URL for this persona only. */
  bridgeUrl: string;
  /** The env's product URL — for the persona's own orientation. */
  productUrl: string;
  contract: AcceptanceContract;
  /** What a naive/returning user is told to accomplish. Never criterion text. */
  goal: string;
  maxTurns: number;
  timeoutMinutes: number;
  runner?: AgentRunner;
}

/** The transport this persona was given, defaulting to the browser. */
function transportOf(opts: RunPersonaOptions): BridgeTransport {
  return opts.spec.transport ?? 'browser';
}

// ─── Prompt construction ─────────────────────────────────────────────────────

function httpGuide(bridgeUrl: string, productUrl: string): string {
  return [
    '## How you see the product',
    '',
    `The product under test is an HTTP service at ${productUrl}. You CANNOT call it directly — you have no`,
    'network access and no file access. You make every call through a local bridge by curling',
    `${bridgeUrl}. The bridge performs the call, writes the whole request and response to an evidence`,
    'record, and hands you back the status, the response body and its schema.',
    '',
    '```bash',
    `B=${bridgeUrl}`,
    `curl -sS -X POST $B/request -H 'content-type: application/json' -d '{"method":"GET","path":"/api/health"}'`,
    `curl -sS -X POST $B/request -H 'content-type: application/json' \\`,
    `     -d '{"method":"POST","path":"/api/tasks","json":{"title":"Buy milk"}}'`,
    `curl -sS -X POST $B/request -H 'content-type: application/json' \\`,
    `     -d '{"method":"POST","path":"/api/tasks","headers":{"content-type":"application/json"},"body":"{not json"}'`,
    'curl -sS    $B/records      # every call you have made, with status and schema',
    '```',
    '',
    'Notes:',
    '- That bridge URL contains YOUR private session token. Never send it to the product under test.',
    "- `path` is resolved against the product's own origin. Any other origin returns 403 — that is the",
    '  harness refusing, not a bug in the product.',
    '- `json` sends a JSON body. `body` sends a RAW string, which is how you send something malformed.',
    '- A 4xx or 5xx is NOT an error here: the call succeeded and its status is the finding. Only a',
    '  malformed instruction returns `{"error": …}`.',
    "- The reply's `record` path is exactly what you must put in `evidence[]`.",
  ].join('\n');
}

function ptyGuide(bridgeUrl: string, productUrl: string): string {
  return [
    '## How you see the product',
    '',
    'The product under test is a command-line tool or library, already built in a clean throwaway',
    `checkout${productUrl ? ` (it also serves ${productUrl})` : ''}. You CANNOT open that checkout — you have no file access. You run commands in it`,
    `by curling a local bridge at ${bridgeUrl}, which runs them for you and keeps the transcript.`,
    '',
    '```bash',
    `B=${bridgeUrl}`,
    'curl -sS    $B/docs         # the README and quickstart — the only documents that exist for you',
    `curl -sS -X POST $B/run  -H 'content-type: application/json' -d '{"argv":["npm","install"]}'`,
    `curl -sS -X POST $B/run  -H 'content-type: application/json' -d '{"argv":["./bin/cli","--help"]}'`,
    `curl -sS -X POST $B/run  -H 'content-type: application/json' -d '{"argv":["sh","-lc","echo hi | ./bin/cli"]}'`,
    'curl -sS    $B/records      # every command you have run, with its exit code',
    '```',
    '',
    'Notes:',
    '- `argv` is an ARRAY, never a shell string. If you genuinely need a pipeline or a redirect, ask for',
    '  `["sh","-lc","…"]` and say so — the harness records that you chose a shell.',
    '- A non-zero exit code is NOT an error here: the command ran, and its exit code is the finding.',
    '- `input` sends text on stdin. Commands are killed after two minutes; a kill is itself a finding.',
    "- The reply's `record` path is exactly what you must put in `evidence[]`.",
  ].join('\n');
}

/**
 * The artifact transport's guide. There is nothing running, so evidence is a
 * citation: the bridge writes a record of every file you read and of the one
 * command the repo declared, and those records are what a screenshot is
 * elsewhere. A claim without a record behind it is worth nothing here.
 */
function fsGuide(bridgeUrl: string): string {
  return [
    '## How you see the product',
    '',
    'This product does not run. It is a set of files — documents, data, code — in a clean throwaway',
    'checkout, and what it PRODUCES is what you judge. You CANNOT open that checkout: you have no file',
    `access. You read it by curling a local bridge at ${bridgeUrl}, which reads the files for you and`,
    'records every read as evidence.',
    '',
    '```bash',
    `B=${bridgeUrl}`,
    'curl -sS    $B/list         # every file in the repo, plus the artifacts and check it declared',
    `curl -sS -X POST $B/read -H 'content-type: application/json' -d '{"path":"paper.md"}'`,
    `curl -sS -X POST $B/run  -d '{}'   # runs ONLY the command the repo declared, if it declared one`,
    'curl -sS    $B/records      # everything you have read and run so far',
    '```',
    '',
    'Notes:',
    '- That bridge URL contains YOUR private session token. Never put it in a file or a command.',
    '- `list` names the DECLARED artifacts — the globs the repo committed to producing. Start there: a',
    '  declared artifact that is missing, empty, or stale is a `blocker`, and the failed read proves it.',
    "- `read` is your citation. Quote the exact line or passage you are relying on in your finding's",
    "  summary, and put the reply's `record` path in `evidence[]`. Never quote something you did not read.",
    '- Paths are inside the repo only. Anything outside it returns 403 — that is the harness refusing.',
    '- `run` takes NO arguments: it executes only the command declared in boot.json (a test, a build). You',
    '  choose whether to run it, never what it is. A non-zero exit is not an error here — it is the finding.',
    '- There is no browser, no server and no shell. Do not describe anything you could not read.',
  ].join('\n');
}

function browserGuide(bridgeUrl: string, productUrl: string): string {
  return [
    '## How you see the product',
    '',
    `The product under test is running at ${productUrl}. You CANNOT open it yourself — you have no`,
    'browser and no file access. You drive a real Chromium browser by curling a local bridge at',
    `${bridgeUrl}. Every call returns JSON. Mutating calls are recorded as evidence automatically,`,
    'and clicks and navigations are screenshotted for you whether you ask or not.',
    '',
    '```bash',
    `B=${bridgeUrl}`,
    `curl -sS -X POST $B/goto      -H 'content-type: application/json' -d '{"url":"/"}'`,
    'curl -sS    $B/snapshot        # accessibility tree + visible text of the current page',
    `curl -sS -X POST $B/click     -H 'content-type: application/json' -d '{"text":"New Task"}'`,
    `curl -sS -X POST $B/click     -H 'content-type: application/json' -d '{"selector":"button[type=submit]"}'`,
    `curl -sS -X POST $B/fill      -H 'content-type: application/json' -d '{"selector":"#title","value":"Buy milk"}'`,
    `curl -sS -X POST $B/press     -H 'content-type: application/json' -d '{"key":"Enter"}'`,
    `curl -sS -X POST $B/back      -d '{}'`,
    `curl -sS -X POST $B/reload    -d '{}'`,
    `curl -sS -X POST $B/viewport  -H 'content-type: application/json' -d '{"w":320,"h":640}'`,
    `curl -sS -X POST $B/newtab    -d '{}'      # then /switchtab {"index":0}`,
    `curl -sS -X POST $B/offline   -H 'content-type: application/json' -d '{"on":true}'`,
    `curl -sS    "$B/screenshot?"   # saves a PNG, returns its evidence path`,
    'curl -sS    $B/console         # console + pageerror entries so far',
    'curl -sS    $B/network         # failed requests and HTTP >=400 responses',
    '```',
    '',
    'Notes:',
    '- That bridge URL contains YOUR private session token. It drives your browser only. Never type it,',
    '  paste it or submit it into the product, and never use a URL you did not receive here.',
    '- `selector` accepts any Playwright selector, including `text=Save`, `role=button[name="Save"]`, and CSS.',
    '- `goto` accepts a path (`/tasks`) or a full URL on the product origin. Any other origin returns 403 —',
    '  that is the harness refusing, not a bug in the product.',
    '- An action that fails returns `{"error": "..."}` with a screenshot path. That is data. Keep going.',
    '- Screenshot paths returned by the bridge are exactly what you must put in `evidence[]`.',
  ].join('\n');
}

function bridgeGuide(transport: BridgeTransport, bridgeUrl: string, productUrl: string): string {
  switch (transport) {
    case 'http':
      return httpGuide(bridgeUrl, productUrl);
    case 'pty':
      return ptyGuide(bridgeUrl, productUrl);
    case 'fs':
      return fsGuide(bridgeUrl);
    case 'browser':
      return browserGuide(bridgeUrl, productUrl);
  }
}

function outputContract(charter: PersonaCharter): string {
  const allowCriterionResults = charter === 'spec-auditor';
  const lines = [
    '## Required output',
    '',
    'Your LAST message must be NOTHING but a single fenced JSON block in exactly this shape:',
    '',
    '```json',
    '{',
    '  "goalAchieved": true,',
    '  "wrongTurns": 0,',
    '  "findings": [',
    '    { "severity": "blocker|major|minor|note", "summary": "what a user experiences, one or two sentences",',
    '      "evidence": ["personas/<you>/shots/03-click.png"], "criterionId": null }',
    '  ]',
  ];
  if (charter === 'explorer') {
    lines.push(
      '  ,',
      '  "journeys": [',
      '    { "title": "Capture a thought", "goal": "what the user is trying to achieve",',
      '      "steps": ["waypoint in plain language"], "tags": ["core"], "rationale": "what I saw that says so" }',
      '  ]',
    );
  }
  if (allowCriterionResults) {
    lines.push(
      '  ,',
      '  "criterionResults": [',
      '    { "criterionId": "crit_1", "status": "met|not-met|not-tested", "evidence": ["personas/<you>/shots/01-goto.png"] }',
      '  ]',
    );
  }
  lines.push(
    '}',
    '```',
    '',
    'Rules:',
    '- `goalAchieved`: true only if you actually accomplished the goal in the product. Use `null` if no single goal applies.',
    '- `wrongTurns`: how many times you clicked/navigated somewhere that turned out not to help.',
    '- `evidence`: bridge-returned paths only. Never invent a path — an unverifiable claim is worse than no claim.',
    '- Report what you OBSERVED. Do not speculate about code you cannot see.',
    '- No prose after the JSON block.',
  );
  if (charter === 'explorer') {
    lines.push(
      '- `findings` is your confusion log: every moment you could not tell what something was for, what',
      '  would happen, or whether your action worked. Be exact about where you were.',
      '- `journeys`: two to six of them, goal-oriented and never a click script.',
    );
  }
  if (!allowCriterionResults) {
    lines.push(
      '- Do NOT include `criterionResults`. You are not the charter that judges criteria, and it will be discarded.',
    );
  }
  return lines.join('\n');
}

/**
 * The saboteur's playbook, per transport. Same charter, same spirit — "break it
 * the way a real person could" — expressed in whatever the persona can actually
 * do. Only the browser can double-click; only the terminal can send a hostile
 * argument; all three can send something the product did not expect.
 */
function sabotagePlaybook(transport: BridgeTransport): string[] {
  switch (transport) {
    case 'browser':
      return [
        '1. Double-submit: click the primary action twice, fast. Does it create two of something?',
        '2. Back button mid-flow: start something, then `/back`. Is your input lost without warning?',
        '3. Reload mid-flow: start something, then `/reload`. Same question.',
        '4. Hostile paste: fill a text field with 10,000 characters, including emoji and right-to-left text.',
        '5. Two tabs: `/newtab`, do a conflicting edit in each, `/switchtab` between them.',
        '6. Kill the network: `/offline {"on":true}`, then act, then `/offline {"on":false}`. Does it lie about success?',
        '7. Tiny screen: `/viewport {"w":320,"h":640}` and try the primary action.',
      ];
    case 'http':
      return [
        '1. Malformed body: send `body` that is not valid JSON to an endpoint that expects JSON. Do you get a',
        '   clean 400, or a 500 with a stack trace in it?',
        '2. Missing and extra fields: omit a required field; then send an unknown field. What happens to it?',
        '3. Wrong types: send a number where a string belongs, `null` where an object belongs, an array where',
        '   a scalar belongs.',
        '4. Hostile values: a 10,000-character string, emoji, right-to-left text, `../../etc/passwd`,',
        "   `<script>alert(1)</script>`, and `'; DROP TABLE tasks; --`. Does any of it come back unescaped?",
        '5. Wrong method and wrong path: POST where only GET exists; GET a resource id that does not exist.',
        '   Is a missing thing a 404, or a 200 with an empty body pretending everything is fine?',
        '6. Repeat the same create call twice. Does it create two of something?',
        '7. No content-type, or the wrong one, on a body the endpoint does expect.',
      ];
    case 'fs':
      // No fs panel staffs a saboteur (panel.ts) — files cannot be attacked, only
      // found wanting. Kept honest rather than empty so the switch stays total.
      return [
        '1. Take each declared artifact in turn and look for what it does NOT contain: a promised section,',
        '   a referenced figure, a cited file that is not in the repo.',
        '2. Read the documents against each other. Where two of them disagree, say which and quote both.',
        '3. Run the declared check twice. Does it pass both times, and does it actually cover the claims?',
      ];
    case 'pty':
      return [
        '1. No arguments at all, then `--help`, then a flag that does not exist. Is the exit code non-zero when',
        '   the command failed, or does it exit 0 while printing an error?',
        '2. Hostile arguments: an empty string, a path that does not exist, `../../etc/passwd`, a 10,000',
        '   character argument, emoji, and a leading `-` where a filename belongs.',
        '3. Wrong input on stdin: send binary junk, then nothing at all, to a command that reads stdin.',
        '4. Run the same mutating command twice. Does it do the thing twice, or refuse the second time?',
        '5. Run a command from the quickstart out of order — the second step without the first.',
        '6. Interrupt it: run something long with a short `timeoutMs`. Does it leave a half-written file or a',
        '   lock behind, so that the next run is broken?',
      ];
  }
}

function charterBody(opts: RunPersonaOptions): string {
  const { spec, contract, goal } = opts;
  const invariants = contract.criteria.filter((c) => c.kind === 'invariant');
  const transport = transportOf(opts);

  switch (spec.charter) {
    case 'naive-user':
      return [
        '## Your charter — Naive User',
        '',
        spec.personaSeed ?? 'You are an ordinary first-time user.',
        '',
        'You have never seen this product before. Nobody has explained it to you. You have exactly one goal:',
        '',
        `> ${goal}`,
        '',
        'Try to accomplish it. Do not read the source, do not guess at internal APIs — behave like a person',
        'poking at a website. If you get stuck, say precisely where you got stuck and what you expected to see.',
        'Count every dead end as a wrong turn. Stop when you have either succeeded or convinced yourself you cannot.',
      ].join('\n');

    case 'saboteur':
      return [
        '## Your charter — Saboteur',
        '',
        'You are a hostile but plausible user. Your job is to break the product in ways a real person could,',
        'then report exactly what the product did about it. You are NOT told what the product is supposed to do;',
        'you are told what it must NEVER do:',
        '',
        ...(invariants.length > 0
          ? invariants.map((c) => `- (${c.id}) ${c.text}`)
          : [
              '- (no invariants were compiled for this contract — use your judgement about data loss and crashes)',
            ]),
        '',
        'Sabotage playbook — work through it and record what happens:',
        ...sabotagePlaybook(transport),
        '',
        'For each invariant above, say whether you managed to violate it, with the evidence record that proves',
        "it. Tie such findings to the invariant's id in `criterionId`. Severity `blocker` means you lost user",
        'data or crashed the product.',
      ].join('\n');

    case 'returning-user':
      return [
        '## Your charter — Returning User',
        '',
        'You have used this product before and you trust it with your data. Your only question is whether it',
        'actually keeps what you give it.',
        '',
        `1. Make one small real change in the product (create or edit something). Your goal: ${goal}`,
        '2. Note exactly what you entered, character for character.',
        '3. `/reload` the page. Is it still there, unchanged?',
        '4. `/newtab` and navigate to the product fresh, as a new session. Is it still there?',
        '5. Screenshot the before and after.',
        '',
        'Report any difference between what you entered and what came back — including silent truncation,',
        'reordering, lost formatting, or a field that came back empty. `goalAchieved` is true only if your data',
        'survived intact.',
      ].join('\n');

    case 'visual-critic':
      return [
        '## Your charter — Visual Critic',
        '',
        "You review the interface itself, not its features. Work through the product's main screens and:",
        '',
        '1. Screenshot each at three viewports: `{"w":320,"h":640}`, `{"w":768,"h":1024}`, `{"w":1440,"h":900}`.',
        '2. If a light/dark toggle is reachable, screenshot both.',
        '3. Reach whatever empty, loading and error states you can (an empty list, a failed action, `/offline`).',
        '4. Traverse one primary flow using only the keyboard: repeated `{"key":"Tab"}` then `{"key":"Enter"}`.',
        '   Report whether focus order follows the visual order and whether the focused element is ever invisible.',
        '',
        'Judge against this rubric and cite a screenshot for every claim:',
        '- Hierarchy: is the most important thing on the screen the most prominent?',
        '- Alignment: do edges line up, or do elements drift by a few pixels?',
        '- Contrast: is any text hard to read against its background? Any text clipped or overlapping?',
        '- Spacing: is anything cramped, touching, or overflowing at 320px wide?',
        '',
        '`goalAchieved` should be `null` — you have no goal, you have a verdict on the craft.',
      ].join('\n');

    case 'spec-auditor':
      return [
        '## Your charter — Spec Auditor',
        '',
        'You hold the full acceptance contract, including criteria that were deliberately withheld from whoever',
        'built this. Walk every criterion LITERALLY, in order, and decide from what you can observe in the',
        'product whether it holds.',
        '',
        'The contract:',
        ...contract.criteria.map((c) => `- (${c.id}, ${c.kind}) ${c.text}`),
        '',
        'For each criterion:',
        ...(transport === 'fs'
          ? [
              '1. Find the passage, file or check output that would demonstrate it, and `/read` it.',
              "2. Quote the exact lines you are relying on, and cite the bridge's record path for that read.",
              '   If the repo declared a check command and the criterion is about behaviour, `/run` it.',
            ]
          : [
              '1. Do the smallest thing in the product that would demonstrate it.',
              '2. Take a screenshot at the moment of truth (the bridge already screenshots clicks and navigations).',
            ]),
        '3. Mark `met` ONLY with affirmative evidence you actually saw. If you could not test it, mark',
        '   `not-tested` — never guess `met`. If the product did something other than the criterion says,',
        '   mark `not-met` and describe the difference precisely.',
        '',
        'Report one entry in `criterionResults` for EVERY criterion id above — no omissions. Add findings for',
        'anything else you noticed. `goalAchieved` should be `null`.',
      ].join('\n');

    case 'naive-developer':
      // On the fs transport there is nothing to install and no quickstart to
      // follow: the deliverable is the product, so the reader's job is to check
      // it against what it claims about itself, citing every claim it relies on.
      if (transport === 'fs') {
        return [
          '## Your charter — First Reader',
          '',
          spec.personaSeed ??
            'You are the first outside reader of this work: competent and interested, with no context beyond\n' +
              'what is written here, and nobody available to explain anything to you.',
          '',
          'You have exactly one question:',
          '',
          `> ${goal}`,
          '',
          'Do this, in this order:',
          '1. `/list` the repo and note which files the project DECLARED as its artifacts.',
          '2. Read every declared artifact. A declared artifact that is missing, empty, or a stub is a',
          '   `blocker` — the failed or empty read is your evidence.',
          '3. Read what the work claims about itself — its own summary, abstract, README or intro — and then',
          '   check each claim against the rest of the repo. Quote the claim, then quote what you found.',
          '4. If the repo declared a check command, `/run` it. A failing check on work that claims to be done',
          '   is a `blocker`; a check that passes while covering none of the claims is `major`.',
          '',
          'Grade what is there, not its prose style:',
          '- A claim with nothing behind it — a result with no data, a reference to a file that does not',
          '  exist, a section the document promises and never delivers — is a `blocker`.',
          '- Content that contradicts another declared artifact is `major`. Say which two, and quote both.',
          '- Something you found genuinely unclear, but which is present and coherent, is at most `minor`.',
          '',
          'Never report a problem you did not read for yourself. Every finding cites the record path the',
          'bridge gave you. `goalAchieved` is true only if the question above is answered by what you read.',
        ].join('\n');
      }
      return [
        '## Your charter — Naive Developer',
        '',
        spec.personaSeed ?? 'You are an ordinary developer trying this out for the first time.',
        '',
        'You found this project five minutes ago. Nobody has explained it to you and there is no support',
        "channel. The documentation IS the product's interface — for a library, the README is the only UI",
        'there is. You have exactly one goal:',
        '',
        `> ${goal}`,
        '',
        'Do this, in this order, and do not deviate:',
        transport === 'pty'
          ? '1. Read the docs the bridge gives you (`/docs`). That is everything you know. There is no source.'
          : '1. Read the documentation you were given. That is everything you know. There is no source code.',
        '2. Follow the quickstart LITERALLY, step by step, exactly as written. Run the commands it prints,',
        '   in the order it prints them, with the arguments it prints.',
        '3. The moment a step does not do what the document says it will, STOP and record it: the exact step,',
        '   what the document promised, and what actually happened including the exit code or status.',
        '4. Only after the documented path is exhausted may you improvise — and every improvisation is a',
        '   wrong turn, because a user who has to guess has already been failed by the document.',
        '',
        'Judge the documentation as a behaviour, not as prose:',
        '- A command in the quickstart that does not exist, or exits non-zero, is a `blocker`.',
        '- A step that silently does nothing, or whose success cannot be told from its failure, is a `blocker`.',
        '- A documented flag, endpoint, or output that does not match what actually happens is `major`.',
        '- A missing prerequisite you had to discover by failing is `major`.',
        '- Prose you found unclear but which still worked is at most `minor`. Do not report style.',
        '',
        'Never report a problem you did not actually hit. `goalAchieved` is true only if you reached the goal',
        'by following the document.',
      ].join('\n');

    case 'explorer':
      return [
        '## Your charter — Explorer',
        '',
        'You are exploring a product nobody has described to you. There is no specification, no task and no',
        'goal — you are here to work out what this thing is FOR, by using it.',
        '',
        'Do two things while you crawl:',
        '1. Work out the two to six things a real user comes to this product to DO, and write each as a',
        "   journey: a goal in the user's own words plus the waypoints they pass through. Goal-oriented,",
        '   never a click script — say "capture a thought and turn it into a task", not "click #btn-3".',
        '2. Keep a confusion log in `findings`: every moment you could not tell what something was for, what',
        "   would happen, or whether your action worked. This is the product's first UX audit, so be exact",
        '   about where you were and what you expected.',
        '',
        '`goalAchieved` should be `null` — you had no goal, you have a map.',
      ].join('\n');
  }
}

const TRANSPORT_NOUN: Record<BridgeTransport, string> = {
  browser: 'a browser bridge',
  http: 'an HTTP bridge',
  pty: 'a terminal bridge',
  fs: 'a file bridge',
};

export function buildPersonaPrompt(opts: RunPersonaOptions): string {
  const transport = transportOf(opts);
  const body = [
    transport === 'fs'
      ? // Nothing is running, so "test the running product" would be an instruction
        // to invent one — which is the failure H5 exists to stop.
        `You are a reviewer on an acceptance panel. This product does not run: you judge what it produces, through ${TRANSPORT_NOUN[transport]}.`
      : `You are a tester on an acceptance panel. You are testing a running product through ${TRANSPORT_NOUN[transport]}.`,
    'You have exactly one tool: Bash, for curl. You have no file access and no source code. Do not try to',
    'read, write, or search files — there is nothing there. Never try to fix the product; you only observe.',
    '',
    charterBody(opts),
    '',
    bridgeGuide(transport, opts.bridgeUrl, opts.productUrl),
    '',
    outputContract(opts.spec.charter),
  ].join('\n');
  // Same 100KB argv guard every daemon prompt gets: a contract with a very long
  // criterion must degrade the prompt, not kill the spawn with E2BIG.
  return enforcePromptLimit(body);
}

// ─── Structured output parsing ───────────────────────────────────────────────

/** Last fenced block wins: models often show an example before their real answer. */
export function extractFencedJson(text: string, what = 'reply'): string {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  if (fences.length === 0) throw new Error(`no fenced JSON block in the ${what}`);
  return fences[fences.length - 1][1];
}

/**
 * Pull the agent's actual reply out of whatever `claude -p --output-format json`
 * produced. Three shapes are real, all seen in practice:
 *   A) `{ "result": "..." }`
 *   B) `[ {type:"system"}, {type:"assistant"}, …, {type:"result", result:"…"} ]`
 *   C) JSONL — one event object per line.
 *
 * Shape B is the common one, and it matters: inside that JSON the reply's
 * newlines are escaped, so searching the raw stdout for a ``` fence finds
 * nothing. Unwrapping first is what makes the fence visible.
 */
export function unwrapCliReply(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const resultFrom = (events: unknown[]): string | null => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i] as { type?: string; result?: unknown };
      if (e?.type === 'result' && typeof e.result === 'string') return e.result;
    }
    // No result event (truncated stream): fall back to assistant text blocks.
    const texts: string[] = [];
    for (const event of events) {
      const e = event as { type?: string; message?: { content?: unknown }; content?: unknown };
      if (e?.type !== 'assistant') continue;
      const content = e.message?.content ?? e.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; text?: unknown };
        if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const reply = resultFrom(parsed);
      if (reply !== null) return reply;
    } else if (parsed !== null && typeof parsed === 'object') {
      const single = (parsed as { result?: unknown }).result;
      if (typeof single === 'string') return single;
    }
    return trimmed;
  } catch {
    // Not one JSON value — try JSONL.
  }

  const events: unknown[] = [];
  for (const line of trimmed.split('\n')) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Not every line is JSON; skip it.
    }
  }
  return resultFrom(events) ?? raw;
}

/**
 * The one path from raw CLI stdout to a parsed JSON object: unwrap the envelope
 * (all three shapes), take the LAST fenced block, parse it.
 *
 * Every parser in the harness — persona, judge, contract compiler — uses this.
 * They each used to carry their own copy, and the copies had drifted: the
 * compiler took the FIRST fenced block (so a model that echoes the prompt's
 * example template yielded the placeholder) and only understood the
 * `{result:"…"}` envelope, not the event-array shape the harness actually spawns.
 */
export function parseCliJsonReply(rawStdout: string, what: string): Record<string, unknown> {
  return JSON.parse(extractFencedJson(unwrapCliReply(rawStdout), what)) as Record<string, unknown>;
}

function parseFindings(value: unknown): PersonaFinding[] {
  if (!Array.isArray(value)) throw new Error('`findings` must be an array');
  return value.map((raw, i) => {
    const f = raw as Record<string, unknown>;
    const severity = String(f.severity);
    if (!SEVERITIES.has(severity))
      throw new Error(`findings[${i}].severity is not a known severity: ${severity}`);
    if (typeof f.summary !== 'string' || f.summary.trim() === '')
      throw new Error(`findings[${i}].summary is empty`);
    return {
      severity: severity as PersonaFinding['severity'],
      summary: f.summary,
      evidence: Array.isArray(f.evidence)
        ? f.evidence.filter((e): e is string => typeof e === 'string')
        : [],
      criterionId: typeof f.criterionId === 'string' ? f.criterionId : null,
    };
  });
}

function parseCriterionResults(value: unknown): PersonaCriterionResult[] {
  if (!Array.isArray(value)) throw new Error('`criterionResults` must be an array');
  return value.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (typeof r.criterionId !== 'string')
      throw new Error(`criterionResults[${i}].criterionId missing`);
    const status = String(r.status);
    if (!CRITERION_STATUSES.has(status))
      throw new Error(`criterionResults[${i}].status invalid: ${status}`);
    return {
      criterionId: r.criterionId,
      status: status as PersonaCriterionResult['status'],
      evidence: Array.isArray(r.evidence)
        ? r.evidence.filter((e): e is string => typeof e === 'string')
        : [],
    };
  });
}

/**
 * A journey the explorer thinks this product has. Structurally the adoption
 * pipeline's `ProposedAdoptionJourney` — kept local so the panel does not depend
 * on the adoption module, and so adopt-repo can adopt this charter by dropping
 * its bespoke prompt, not by rewiring its types.
 */
export interface ProposedJourney {
  title: string;
  goal: string;
  steps: string[];
  tags: string[];
  rationale: string;
}

export interface ParsedPersonaOutput {
  goalAchieved: boolean | null;
  wrongTurns: number;
  findings: PersonaFinding[];
  criterionResults: PersonaCriterionResult[] | null;
  /** Only the explorer populates this; null for every other charter. */
  proposedJourneys: ProposedJourney[] | null;
}

function parseProposedJourneys(value: unknown): ProposedJourney[] {
  if (!Array.isArray(value)) throw new Error('`journeys` must be an array');
  return value.map((raw, i) => {
    const j = raw as Record<string, unknown>;
    const text = (key: string): string => {
      const v = j[key];
      if (typeof v !== 'string' || v.trim() === '')
        throw new Error(`journeys[${i}].${key} is empty`);
      return v;
    };
    const list = (key: string): string[] =>
      Array.isArray(j[key])
        ? (j[key] as unknown[]).filter((s): s is string => typeof s === 'string')
        : [];
    return {
      title: text('title'),
      goal: text('goal'),
      steps: list('steps'),
      tags: list('tags'),
      rationale: typeof j.rationale === 'string' ? j.rationale : '',
    };
  });
}

/**
 * Parse a persona's structured reply. Throws on anything malformed — the caller
 * turns a throw into `invalid: true`, which can never be a pass.
 *
 * The charter is the gate on the optional blocks: only the spec-auditor may mark
 * criteria (a naive user claiming `criterionResults` has them dropped), and only
 * the explorer proposes journeys.
 */
export function parsePersonaOutput(
  rawStdout: string,
  charter: PersonaCharter,
): ParsedPersonaOutput {
  const allowCriterionResults = charter === 'spec-auditor';
  const parsed = parseCliJsonReply(rawStdout, "persona's reply");

  const goalAchieved =
    parsed.goalAchieved === null || parsed.goalAchieved === undefined
      ? null
      : typeof parsed.goalAchieved === 'boolean'
        ? parsed.goalAchieved
        : (() => {
            throw new Error('`goalAchieved` must be a boolean or null');
          })();

  const wrongTurns =
    typeof parsed.wrongTurns === 'number' && parsed.wrongTurns >= 0
      ? Math.round(parsed.wrongTurns)
      : 0;

  return {
    goalAchieved,
    wrongTurns,
    findings: parseFindings(parsed.findings ?? []),
    criterionResults:
      allowCriterionResults && parsed.criterionResults !== undefined
        ? parseCriterionResults(parsed.criterionResults)
        : null,
    proposedJourneys:
      charter === 'explorer' && parsed.journeys !== undefined
        ? parseProposedJourneys(parsed.journeys)
        : null,
  };
}

/**
 * Classify a dead persona's raw CLI stdout as an API-level fault (429 or auth
 * rejection), reading ONLY the structured fields the CLI itself emits —
 * `type`, `is_error`, `api_error_status`, `rate_limit_info.resetsAt` — never
 * matching on the prose of `result` (docs/history/CONTRACTS.md §5's structured-output
 * rule applies to what the harness reads back out of a transcript too).
 *
 * `null` for anything else: a parse failure, a crash with no such event, or a
 * plain non-zero exit from the product under test. Those stay unclassified —
 * mirrors `RunFailureCause` elsewhere never being invented from a message string.
 */
export function classifyPersonaApiFailure(
  stdout: string,
): { causeKind: RunFailureCause; resumesAt?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const events = Array.isArray(parsed) ? parsed : [parsed];

  let resumesAt: string | undefined;
  for (const e of events) {
    const info = (e as { rate_limit_info?: { resetsAt?: unknown } } | null)?.rate_limit_info;
    if (typeof info?.resetsAt === 'number')
      resumesAt = new Date(info.resetsAt * 1000).toISOString();
  }

  for (const e of events) {
    const r = e as { type?: unknown; is_error?: unknown; api_error_status?: unknown } | null;
    if (r?.type !== 'result' || r.is_error !== true) continue;
    const status = r.api_error_status;
    if (status === 401 || status === 403)
      return { causeKind: 'auth', ...(resumesAt ? { resumesAt } : {}) };
    if (status === 429) return { causeKind: 'rate-limit', ...(resumesAt ? { resumesAt } : {}) };
  }
  return null;
}

/**
 * The cause when EVERY report in a panel is invalid with the SAME class of
 * API-level fault (429 or auth) — there is no evidence anywhere in the panel
 * for a judge to weigh. `null` for a mixed panel, an empty one, or invalid
 * runs the classifier above did not name — those still go to judgment
 * (docs/history/CONTRACTS.md §5: an invalid run degrades evidence, it does not by
 * itself decide the run's fate). Shared by run-verification.ts and
 * run-journey.ts, the two callers that turn a panel into a verdict.
 */
export function allInvalidByApiFault(
  reports: PersonaReport[],
): { causeKind: RunFailureCause; resumesAt?: string } | null {
  if (reports.length === 0) return null;
  const causes = reports.map((r) => (r.invalid ? r.causeKind : undefined));
  if (!causes.every((c) => c === 'rate-limit' || c === 'auth')) return null;
  const causeKind: RunFailureCause = causes.every((c) => c === 'auth') ? 'auth' : 'rate-limit';
  const resumesAt = reports
    .map((r) => r.resumesAt)
    .filter((r): r is string => !!r)
    .sort()[0];
  return resumesAt ? { causeKind, resumesAt } : { causeKind };
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

function countSteps(stepsFile: string): number {
  if (!existsSync(stepsFile)) return 0;
  return readFileSync(stepsFile, 'utf-8')
    .split('\n')
    .filter((l) => l.trim()).length;
}

/**
 * Run one persona to completion and write its report.json. Never throws for a
 * misbehaving agent: a crash, a timeout or unparseable output all produce a
 * report with `invalid: true`.
 *
 * It DOES throw `GovernorAbort` when the quota governor kills the run (kill
 * switch, or no quota for 20 minutes) — that is a broken run, not a verdict.
 */
export async function runPersona(opts: RunPersonaOptions): Promise<PersonaReport> {
  const personaDir = path.join(opts.runDir, 'personas', opts.spec.name);
  const sandbox = path.join(personaDir, 'sandbox');
  mkdirSync(sandbox, { recursive: true });

  const relDir = path.posix.join('personas', opts.spec.name);
  const transcriptFile = path.join(personaDir, 'transcript.jsonl');
  const stepsFile = path.join(personaDir, 'steps.jsonl');
  // Touch steps.jsonl so the evidence layout exists even for a persona that never acts.
  if (!existsSync(stepsFile)) writeFileSync(stepsFile, '', 'utf-8');

  const appendTranscript = (stream: 'stdout' | 'stderr', chunk: string): void => {
    // Same scrubbing discipline as OutputWriter (scripts/daemon/output-writer.ts);
    // reusing its scrubCredentials directly rather than copying the patterns.
    appendFileSync(
      transcriptFile,
      `${JSON.stringify({ ts: new Date().toISOString(), stream, text: scrubCredentials(chunk) })}\n`,
      'utf-8',
    );
  };

  const runner = opts.runner ?? new AgentRunner(sandbox);
  const startedAt = Date.now();

  const base: PersonaReport = {
    charter: opts.spec.charter,
    runId: opts.runId,
    personaSeed: opts.spec.personaSeed,
    goalAchieved: null,
    stepCount: 0,
    wrongTurns: 0,
    elapsedMs: 0,
    findings: [],
    criterionResults: null,
    transcriptPath: path.posix.join(relDir, 'transcript.jsonl'),
    invalid: true,
  };

  const finish = (report: PersonaReport): PersonaReport => {
    const complete = {
      ...report,
      stepCount: countSteps(stepsFile),
      elapsedMs: Date.now() - startedAt,
    };
    writeFileSync(path.join(personaDir, 'report.json'), JSON.stringify(complete, null, 2), 'utf-8');
    return complete;
  };

  // Quota gate — claims the slot atomically, so two concurrent personas cannot
  // both take the last one. A denial WAITS rather than aborting: the panel has
  // already spent sessions on the personas that ran, and half a panel is evidence
  // of nothing. Only the kill switch (or 20 minutes of no quota) throws, and that
  // throw is what marks the whole run "error" instead of passed/failed.
  const backend = await awaitClaimedSlot('persona', {
    label: `persona ${opts.spec.name}`,
    ref: `${opts.runId}/${opts.spec.name}`,
  });

  let result: Awaited<ReturnType<AgentRunner['spawnAgent']>>;
  try {
    result = await runner.spawnAgent({
      prompt: buildPersonaPrompt(opts),
      maxTurns: opts.maxTurns,
      timeoutMinutes: opts.timeoutMinutes,
      // Personas must never write to the repo: no permission bypass, Bash only,
      // plus the charter's own deny rules (the naive-developer's source lockout).
      skipPermissions: false,
      ...personaToolGrant(opts.spec.charter),
      role: 'persona',
      cwd: sandbox,
      backend,
      model: modelForBackend(backend, loadConfig().execution.harness.personaModel),
      onStdoutChunk: (chunk) => appendTranscript('stdout', chunk),
      onStderrChunk: (chunk) => appendTranscript('stderr', chunk),
    });
  } catch (err) {
    appendTranscript('stderr', `spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    return finish(base);
  }

  if (result.exitCode !== 0 || result.timedOut) {
    appendTranscript(
      'stderr',
      `persona exited ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
    );
    const apiFailure = classifyPersonaApiFailure(result.stdout);
    return finish(apiFailure ? { ...base, ...apiFailure } : base);
  }

  try {
    // proposedJourneys is deliberately dropped: it is not part of the pinned
    // PersonaReport. Callers that want it (adoption) parse the reply themselves.
    const { proposedJourneys: _ignored, ...parsed } = parsePersonaOutput(
      result.stdout,
      opts.spec.charter,
    );
    return finish({ ...base, ...parsed, invalid: false });
  } catch (err) {
    appendTranscript(
      'stderr',
      `unparseable persona output: ${err instanceof Error ? err.message : String(err)}`,
    );
    return finish(base);
  }
}

/**
 * panel.ts — shape-aware panel selection.
 *
 * The pipeline adapts to what the project actually is (UX spec §3): a UI app is
 * verified by browser personas, a headless one by consumer personas, a mixed one
 * by both. This module is the whole of that decision — which transports a run
 * needs, which charters staff each one, and which bridge to stand up — so
 * run-journey and run-verification each pick a panel in three lines instead of
 * growing their own opinion about shapes.
 */

import path from 'node:path';
import type { ProjectShape } from '@ligma/api';
import type { Bridge, BridgeTransport } from './bridge-server';
import { startBridge } from './browser-bridge';
import { startFsBridge } from './fs-bridge';
import { startHttpBridge } from './http-bridge';
import { DEVELOPER_SEEDS, NAIVE_SEEDS, type PersonaSpec } from './personas';
import { startPtyBridge } from './pty-bridge';

export type { BridgeTransport };

/** Journey tags that name a transport outright. A tag beats the project shape. */
const TAG_TRANSPORTS: Record<string, BridgeTransport> = {
  ui: 'browser',
  browser: 'browser',
  web: 'browser',
  api: 'http',
  http: 'http',
  rest: 'http',
  cli: 'pty',
  terminal: 'pty',
  command: 'pty',
};

/**
 * Which bridges this run needs.
 *
 * Tags win when a journey names its own surface — "the CLI journey of a mixed
 * project" is a CLI journey, and booting Chromium for it proves nothing. With no
 * tag the shape decides, and a headless project is judged over HTTP when its
 * boot recipe actually serves something and over the terminal when it does not.
 */
export function panelTransports(
  shape: ProjectShape,
  tags: string[],
  servesHttp: boolean,
): BridgeTransport[] {
  // An artifact project has exactly one surface: the files it produces. A tag
  // cannot conjure a browser for a paper, so the shape wins here and only here.
  if (shape === 'artifact') return ['fs'];

  const tagged = [
    ...new Set(
      tags.map((t) => TAG_TRANSPORTS[t.toLowerCase()]).filter((t): t is BridgeTransport => !!t),
    ),
  ];
  if (tagged.length > 0) return tagged;

  const headless: BridgeTransport = servesHttp ? 'http' : 'pty';
  if (shape === 'ui') return ['browser'];
  if (shape === 'headless') return [headless];
  return ['browser', headless];
}

export interface RosterOptions {
  /** Two spawns instead of six — wiring checks and smoke schedules. */
  smoke: boolean;
  /** How many first-time users to run. Capped by the number of seeds we have. */
  naiveRuns?: number;
  /**
   * An acceptance run also attacks and critiques; a journey run walks the flow
   * and checks it. Journeys run on a schedule, so their panel is the cheap one.
   */
  kind?: 'acceptance' | 'journey';
}

/**
 * Who staffs one transport's panel.
 *
 * The walker charter is the transport's naive user: a person poking at a website
 * for a browser, a developer following the README for anything headless. The
 * auditor is always there — it is the only charter allowed to mark criteria met.
 */
export function transportRoster(transport: BridgeTransport, opts: RosterOptions): PersonaSpec[] {
  const { smoke, naiveRuns = 1, kind = 'acceptance' } = opts;
  const auditor: PersonaSpec = {
    charter: 'spec-auditor',
    name: 'spec-auditor',
    personaSeed: null,
    transport,
  };
  const browser = transport === 'browser';

  // An artifact panel is two sessions, not fifteen (H5). A paper cannot be
  // sabotaged, has no second visit for a returning user and no craft for a
  // visual critic — those charters spent a session each on a question the
  // product cannot answer. The auditor adjudicates; one reader reads it cold.
  if (transport === 'fs') {
    // No seed: the personas' seeds are ways of USING a product, and this reader
    // is not using anything. Its charter supplies the framing instead.
    const reader: PersonaSpec = {
      charter: 'naive-developer',
      name: 'naive-developer-1',
      personaSeed: null,
      transport,
    };
    return smoke ? [auditor] : [auditor, reader];
  }

  // The naive-developer is the headless naive user: it reads the README and
  // follows it, so doc rot lands as a behavioural failure rather than a complaint.
  const seeds = browser ? NAIVE_SEEDS : DEVELOPER_SEEDS;
  const charter = browser ? ('naive-user' as const) : ('naive-developer' as const);
  const walkers = (n: number): PersonaSpec[] =>
    Array.from({ length: n }, (_, i) => ({
      charter,
      name: `${charter}-${i + 1}`,
      personaSeed: seeds[i % seeds.length],
      transport,
    }));

  if (smoke) return [...walkers(1), auditor];

  return [
    // The auditor runs FIRST: it is the only charter allowed to mark criteria
    // met, so a panel starved of quota partway through still adjudicates —
    // colour commentary is what gets dropped, never the verdict's substance.
    auditor,
    ...walkers(naiveRuns),
    // A saboteur and a visual critic cost a session each and answer questions a
    // journey run is not asking: "can it be broken" and "is it well made".
    ...(kind === 'acceptance'
      ? ([{ charter: 'saboteur', name: 'saboteur', personaSeed: null, transport }] as PersonaSpec[])
      : []),
    { charter: 'returning-user', name: 'returning-user', personaSeed: null, transport },
    // Nothing to look at on a headless product.
    ...(kind === 'acceptance' && browser
      ? ([
          { charter: 'visual-critic', name: 'visual-critic', personaSeed: null, transport },
        ] as PersonaSpec[])
      : []),
  ];
}

/**
 * The whole panel across every transport this run needs.
 *
 * Persona directory names must stay unique — they ARE the evidence paths — so a
 * two-transport run suffixes them. A single-transport run keeps the names the
 * evidence UI and the existing tests already know.
 */
export function panelRoster(transports: BridgeTransport[], opts: RosterOptions): PersonaSpec[] {
  return transports.flatMap((transport) =>
    transportRoster(transport, opts).map((spec) => ({
      ...spec,
      name: transports.length > 1 ? `${spec.name}-${transport}` : spec.name,
    })),
  );
}

export interface PanelBridgeOptions {
  runDir: string;
  /** The env's product URL. Required for browser and http. */
  productUrl: string | null;
  /** The ephemeral env's worktree. Required for pty and fs. */
  worktreePath?: string | null;
  /** Repo-relative directory the product was built in ("." for the root). */
  appDir?: string;
  /** boot.json's `artifacts` globs. Required for fs — it is what the panel reads. */
  artifacts?: string[];
  /** boot.json's `check`: the only command an fs panel may run. */
  check?: string[] | null;
}

/** Stand up the bridge one transport needs. */
export function startPanelBridge(
  transport: BridgeTransport,
  opts: PanelBridgeOptions,
): Promise<Bridge> {
  switch (transport) {
    case 'browser':
      if (!opts.productUrl)
        throw new Error('a browser panel needs a product URL — the env booted without one');
      return startBridge({ origin: opts.productUrl, runDir: opts.runDir });
    case 'http':
      if (!opts.productUrl)
        throw new Error('an HTTP panel needs a product URL — the env booted without one');
      return startHttpBridge({ baseUrl: opts.productUrl, runDir: opts.runDir });
    case 'pty':
      if (!opts.worktreePath)
        throw new Error("a terminal panel needs the env's worktree — none was created");
      return startPtyBridge({
        cwd: path.join(opts.worktreePath, opts.appDir ?? '.'),
        runDir: opts.runDir,
        productUrl: opts.productUrl,
      });
    case 'fs':
      if (!opts.worktreePath)
        throw new Error("an artifact panel needs the env's worktree — none was created");
      if (!opts.artifacts?.length) {
        throw new Error(
          "an artifact panel needs boot.json's `artifacts` — with nothing declared there is nothing to verify",
        );
      }
      return startFsBridge({
        root: path.join(opts.worktreePath, opts.appDir ?? '.'),
        runDir: opts.runDir,
        artifacts: opts.artifacts,
        check: opts.check ?? null,
      });
  }
}

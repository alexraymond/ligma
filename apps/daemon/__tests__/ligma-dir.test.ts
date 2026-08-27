/**
 * `.ligma/` IO: boot.json validation, journey files, project.md.
 *
 * Everything here runs against a throwaway directory — this module never reads
 * the real data store, so it belongs in the unit suite.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendProjectMd,
  appendQuirk,
  bootPath,
  deleteJourney,
  journeyIdFrom,
  journeysDir,
  listJourneys,
  readBoot,
  readJourney,
  readKnowledge,
  readProjectMd,
  readQuirks,
  writeBoot,
  writeJourney,
} from '../src/store/ligma-dir';

let repo: string;

/** These cases are all server recipes; `dev: null` would be the other kind. */
function serverBoot(repoPath: string) {
  const boot = readBoot(repoPath).boot;
  if (!boot || boot.dev === null) throw new Error('expected a ready server recipe');
  return boot;
}

const VALID_BOOT = {
  appDir: 'apps/web',
  install: ['pnpm', 'install'],
  dev: ['pnpm', 'exec', 'next', 'dev'],
  portStrategy: { kind: 'flag', flag: '-p' },
  healthPath: '/',
  healthMarker: 'Ligma',
  seed: null,
};

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'ligma-dir-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('boot.json', () => {
  it('reports a repo with no .ligma/ as missing, not broken', () => {
    const read = readBoot(repo);
    expect(read.status).toBe('missing');
    expect(read.boot).toBeNull();
    expect(read.error).toBeNull();
  });

  it('round-trips a valid recipe and fills the documented defaults', () => {
    writeBoot(repo, {
      dev: ['npm', 'start'],
      portStrategy: { kind: 'env', var: 'PORT' },
      healthMarker: 'Hello',
    });
    const read = readBoot(repo);
    expect(read.status).toBe('ready');
    expect(read.boot).toMatchObject({ appDir: '.', healthPath: '/', install: null, seed: null });
  });

  it('accepts every port strategy', () => {
    for (const portStrategy of [
      { kind: 'flag', flag: '-p' },
      { kind: 'env', var: 'PORT' },
      { kind: 'fixed', port: 3000 },
    ]) {
      writeBoot(repo, { ...VALID_BOOT, portStrategy });
      expect(serverBoot(repo).portStrategy).toEqual(portStrategy);
    }
  });

  it('refuses a shell string where an argv array belongs', () => {
    // The whole point of argv arrays: nothing is ever word-split, so nothing can
    // smuggle a `;` past the spawn.
    expect(() => writeBoot(repo, { ...VALID_BOOT, dev: 'pnpm dev; rm -rf /' })).toThrow();
  });

  it('refuses an empty dev command and a missing health marker', () => {
    expect(() => writeBoot(repo, { ...VALID_BOOT, dev: [] })).toThrow();
    expect(() => writeBoot(repo, { ...VALID_BOOT, healthMarker: '' })).toThrow();
  });

  it('refuses an unknown port strategy', () => {
    expect(() => writeBoot(repo, { ...VALID_BOOT, portStrategy: { kind: 'guess' } })).toThrow();
  });

  it('reports a hand-broken recipe as invalid, naming the field', () => {
    mkdirSync(path.dirname(bootPath(repo)), { recursive: true });
    writeFileSync(
      bootPath(repo),
      JSON.stringify({ ...VALID_BOOT, portStrategy: { kind: 'flag' } }),
      'utf-8',
    );
    const read = readBoot(repo);
    expect(read.status).toBe('invalid');
    expect(read.error).toContain('flag');
  });

  it('reports unparseable JSON as invalid rather than throwing', () => {
    mkdirSync(path.dirname(bootPath(repo)), { recursive: true });
    writeFileSync(bootPath(repo), '{not json', 'utf-8');
    expect(readBoot(repo).status).toBe('invalid');
  });
});

/**
 * The artifact recipe (H5). A research repo, a paper, a library with no UI: it
 * has no dev server, so demanding one is what made such a project fabricate an
 * HTTP endpoint to be verifiable at all. `dev: null` is the whole discriminant.
 */
describe('boot.json — artifact recipes', () => {
  const ARTIFACT_BOOT = {
    appDir: '.',
    install: null,
    dev: null,
    artifacts: ['paper.md', 'docs/*.md'],
    check: ['python', '-m', 'pytest'],
  };

  it('round-trips an artifact recipe and defaults `check` to null', () => {
    writeBoot(repo, { dev: null, artifacts: ['paper.md'] });
    const read = readBoot(repo);
    expect(read.status).toBe('ready');
    expect(read.boot).toEqual({
      appDir: '.',
      install: null,
      dev: null,
      artifacts: ['paper.md'],
      check: null,
    });
  });

  it('keeps the declared check command as an argv array', () => {
    writeBoot(repo, ARTIFACT_BOOT);
    expect(readBoot(repo).boot).toMatchObject({ check: ['python', '-m', 'pytest'] });
  });

  it('refuses an artifact recipe that declares no artifacts', () => {
    expect(() => writeBoot(repo, { dev: null, artifacts: [] })).toThrow();
    expect(() => writeBoot(repo, { dev: null })).toThrow();
  });

  it('refuses a shell string as the check command', () => {
    expect(() => writeBoot(repo, { ...ARTIFACT_BOOT, check: 'pytest && rm -rf /' })).toThrow();
  });

  it('refuses a recipe that is neither: a dev server with no health marker', () => {
    expect(() =>
      writeBoot(repo, { dev: ['npm', 'start'], portStrategy: { kind: 'env', var: 'PORT' } }),
    ).toThrow();
  });

  it('still names the broken field when a server recipe is hand-broken', () => {
    mkdirSync(path.dirname(bootPath(repo)), { recursive: true });
    writeFileSync(
      bootPath(repo),
      JSON.stringify({ ...VALID_BOOT, portStrategy: { kind: 'flag' } }),
      'utf-8',
    );
    expect(readBoot(repo).error).toContain('flag');
  });
});

describe('journeys', () => {
  const journey = {
    title: 'Capture a thought',
    goal: 'Get an idea into the system without filling in a form',
    steps: ['find somewhere to write it down', 'see it listed'],
    tags: ['core'],
    origin: 'human' as const,
    schedule: null,
  };

  it('derives a filename-safe id from the title', () => {
    expect(journeyIdFrom('Capture a thought → task!')).toBe('jrn_capture-a-thought-task');
  });

  it('writes one file per journey and reads it back', () => {
    const written = writeJourney(repo, journey);
    expect(existsSync(path.join(journeysDir(repo), `${written.id}.json`))).toBe(true);
    expect(readJourney(repo, written.id)).toEqual(written);
  });

  it('keeps createdAt across an update but moves updatedAt', async () => {
    const first = writeJourney(repo, journey);
    await new Promise((r) => setTimeout(r, 5));
    const second = writeJourney(repo, { ...journey, id: first.id, title: 'Renamed' });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.title).toBe('Renamed');
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.createdAt).getTime(),
    );
  });

  it('refuses a journey id that would escape the journeys dir', () => {
    expect(() => writeJourney(repo, { ...journey, id: '../../../etc/passwd' })).toThrow();
    expect(() => writeJourney(repo, { ...journey, id: 'a/b' })).toThrow();
  });

  it('surfaces a broken journey file instead of hiding it', () => {
    writeJourney(repo, journey);
    writeFileSync(path.join(journeysDir(repo), 'broken.json'), '{"id":"broken"}', 'utf-8');
    const read = listJourneys(repo);
    expect(read.journeys).toHaveLength(1);
    expect(read.invalid).toHaveLength(1);
    expect(read.invalid[0].file).toBe('broken.json');
  });

  it('deletes by id and reports whether there was anything to delete', () => {
    const written = writeJourney(repo, journey);
    expect(deleteJourney(repo, written.id)).toBe(true);
    expect(deleteJourney(repo, written.id)).toBe(false);
  });
});

describe('project.md', () => {
  it('starts a notes file and appends dated entries with their source', () => {
    appendProjectMd(repo, 'The scheduler drops queued work under load.', 'vrun_1');
    appendProjectMd(repo, 'Second thing learned.', 'human');
    const text = readProjectMd(repo);
    expect(text.startsWith('# Project notes')).toBe(true);
    expect(text).toContain('vrun_1');
    expect(text).toContain('Second thing learned.');
    // Appending never loses what was there before.
    expect(text).toContain('The scheduler drops queued work under load.');
  });
});

describe('readKnowledge', () => {
  it('answers for a project with no repo at all', () => {
    const knowledge = readKnowledge('proj_1', null);
    expect(knowledge).toMatchObject({
      repoPath: null,
      bootStatus: 'missing',
      journeys: [],
      projectMd: '',
    });
  });

  it('renders the whole directory in one read', () => {
    writeBoot(repo, VALID_BOOT);
    writeJourney(repo, {
      title: 'T',
      goal: 'G',
      steps: [],
      tags: [],
      origin: 'discovery',
      schedule: null,
    });
    appendProjectMd(repo, 'note', 'human');

    const knowledge = readKnowledge('proj_1', repo);
    expect(knowledge.bootStatus).toBe('ready');
    expect(knowledge.journeys).toHaveLength(1);
    expect(knowledge.projectMd).toContain('note');
    expect(knowledge.invalidJourneys).toEqual([]);
  });
});

/** The journeys this repo hand-authored about itself. Others may exist. */
const DOGFOOD_JOURNEY_IDS = [
  'jrn_answer_a_decision',
  'jrn_capture_to_task',
  'jrn_task_to_verified_done',
];

describe('the dogfood repo adopts itself', () => {
  const REPO_ROOT = path.resolve(__dirname, '../../..');

  it('ships a valid boot recipe and three hand-authored journeys', () => {
    const boot = readBoot(REPO_ROOT);
    expect(boot.status).toBe('ready');
    expect(serverBoot(REPO_ROOT).healthMarker).toBeTruthy();

    const { journeys, invalid } = listJourneys(REPO_ROOT);
    expect(invalid).toEqual([]);
    // The three hand-authored dogfood journeys must exist; the repo may carry
    // more (e.g. the acceptance-campaign chains) without this test caring.
    expect(journeys.map((j) => j.id)).toEqual(expect.arrayContaining(DOGFOOD_JOURNEY_IDS));
    // Goal-oriented, not click scripts (twin-primitives §2). Scoped to the three
    // hand-authored journeys the assertion above names, matching the rule the
    // comment above already states: the repo may carry more — acceptance-campaign
    // chains, and journeys an adoption crawl proposed (`origin: "discovery"`) —
    // and this test does not care about them.
    const authored = journeys.filter((j) => DOGFOOD_JOURNEY_IDS.includes(j.id));
    expect(authored).toHaveLength(DOGFOOD_JOURNEY_IDS.length);
    for (const j of authored) {
      expect(j.origin).toBe('human');
      expect(j.goal.length).toBeGreaterThan(20);
      expect(j.steps.length).toBeGreaterThan(0);
    }
  });

  it('keeps no baseline inside the repo — baselines are central only', () => {
    expect(existsSync(path.join(REPO_ROOT, '.ligma', 'baselines'))).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, '.ligma', 'probes'))).toBe(false);
    expect(readFileSync(path.join(REPO_ROOT, '.ligma', 'project.md'), 'utf-8')).toContain('boot');
  });
});

/**
 * Quirks — `project.md`'s one conventional section (UX spec §6 Knowledge).
 *
 * The daemon writes the heading, so slicing the document at it is addressing a
 * container we own. Nothing below reads meaning out of the prose inside.
 */
describe('quirks', () => {
  it('is empty for a repo that has recorded none', () => {
    appendProjectMd(repo, 'some unrelated note');
    expect(readQuirks(repo)).toBe('');
  });

  it('creates the section on the first quirk, and reads it back without its heading', () => {
    appendQuirk(repo, 'the dev server needs two starts on a cold cache', 'human');
    const body = readQuirks(repo);
    expect(body).toContain('the dev server needs two starts');
    expect(body).not.toContain('## Quirks');
    expect(readProjectMd(repo)).toContain('## Quirks');
  });

  it('stamps who learned it, so a quirk is never anonymous', () => {
    appendQuirk(repo, 'seeding twice duplicates every row', 'adoption:arun_1');
    expect(readQuirks(repo)).toContain('adoption:arun_1');
  });

  it('adds later quirks to the section instead of a second one', () => {
    appendQuirk(repo, 'first quirk');
    appendQuirk(repo, 'second quirk');
    const md = readProjectMd(repo);
    expect(md.match(/^## Quirks$/gm)).toHaveLength(1);
    const body = readQuirks(repo);
    expect(body.indexOf('first quirk')).toBeLessThan(body.indexOf('second quirk'));
  });

  it('stops at the next heading — a later dated note is not a quirk', () => {
    appendQuirk(repo, 'the quirk');
    appendProjectMd(repo, 'an ordinary note', 'run_9');
    const body = readQuirks(repo);
    expect(body).toContain('the quirk');
    expect(body).not.toContain('an ordinary note');
  });

  it('finds a section a human wrote by hand, whatever case they used', () => {
    mkdirSync(path.join(repo, '.ligma'), { recursive: true });
    writeFileSync(
      path.join(repo, '.ligma', 'project.md'),
      '# Project notes\n\n## quirks\n\n- the API is 1-indexed\n\n## Other\n\nnope\n',
      'utf-8',
    );
    expect(readQuirks(repo)).toBe('- the API is 1-indexed');
  });

  it('is carried on the knowledge payload the Knowledge tab renders', () => {
    appendQuirk(repo, 'ports below 3000 are taken by the host');
    expect(readKnowledge('proj_1', repo).quirks).toContain('ports below 3000');
  });

  it('is an empty string for a project with no repo at all', () => {
    expect(readKnowledge('proj_1', null).quirks).toBe('');
  });
});

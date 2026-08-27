import type { Project } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import {
  LAST_PROJECT_KEY,
  RAIL_CAP,
  RECENT_PROJECTS_KEY,
  RING_WORD,
  type RailStorage,
  defaultStagePath,
  railOrder,
  railRingState,
  railTooltip,
  readLastProject,
  readRecentProjects,
  recordProjectVisit,
  stagesFor,
} from './rail';

function memoryStorage(
  seed: Record<string, string> = {},
): RailStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

/** Storage that refuses to write — private mode, quota. */
function hostileStorage(): RailStorage {
  return {
    getItem: () => {
      throw new Error('nope');
    },
    setItem: () => {
      throw new Error('nope');
    },
  };
}

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    description: '',
    status: 'active',
    color: '#fff',
    teamMembers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    deletedAt: null,
    ...extra,
  };
}

describe('readRecentProjects', () => {
  it('is empty before anything is recorded', () => {
    expect(readRecentProjects(memoryStorage())).toEqual([]);
  });

  it('reads the MRU back in order', () => {
    const storage = memoryStorage({ [RECENT_PROJECTS_KEY]: JSON.stringify(['a', 'b']) });
    expect(readRecentProjects(storage)).toEqual(['a', 'b']);
  });

  it('treats corrupt, non-array and non-string entries as no memory rather than crashing the rail', () => {
    expect(readRecentProjects(memoryStorage({ [RECENT_PROJECTS_KEY]: '{{{' }))).toEqual([]);
    expect(readRecentProjects(memoryStorage({ [RECENT_PROJECTS_KEY]: '"a"' }))).toEqual([]);
    expect(
      readRecentProjects(memoryStorage({ [RECENT_PROJECTS_KEY]: '["a",7,"",null,"b"]' })),
    ).toEqual(['a', 'b']);
  });

  it('caps a stored list that grew past the cap elsewhere', () => {
    const long = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const storage = memoryStorage({ [RECENT_PROJECTS_KEY]: JSON.stringify(long) });
    expect(readRecentProjects(storage)).toHaveLength(RAIL_CAP);
  });

  it('survives storage that throws on read', () => {
    expect(readRecentProjects(hostileStorage())).toEqual([]);
  });
});

describe('recordProjectVisit', () => {
  it('puts the visited project first', () => {
    const storage = memoryStorage();
    recordProjectVisit(storage, 'a');
    recordProjectVisit(storage, 'b');
    expect(readRecentProjects(storage)).toEqual(['b', 'a']);
  });

  it('moves a revisit to the front instead of duplicating it', () => {
    const storage = memoryStorage();
    for (const id of ['a', 'b', 'c', 'a']) recordProjectVisit(storage, id);
    expect(readRecentProjects(storage)).toEqual(['a', 'c', 'b']);
  });

  it('caps at 8, dropping the least recent', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 12; i++) recordProjectVisit(storage, `p${i}`);
    const recents = readRecentProjects(storage);
    expect(recents).toHaveLength(RAIL_CAP);
    expect(recents[0]).toBe('p11');
    expect(recents).not.toContain('p0');
  });

  it("writes the last-project key on the same visit, so Home's door and the rail cannot disagree", () => {
    const storage = memoryStorage();
    recordProjectVisit(storage, 'a');
    recordProjectVisit(storage, 'b');
    expect(storage.map.get(LAST_PROJECT_KEY)).toBe('b');
    expect(readLastProject(storage)).toBe('b');
    expect(readRecentProjects(storage)[0]).toBe('b');
  });

  it('ignores an empty id rather than recording a project that does not exist', () => {
    const storage = memoryStorage();
    recordProjectVisit(storage, 'a');
    recordProjectVisit(storage, '');
    expect(readRecentProjects(storage)).toEqual(['a']);
    expect(readLastProject(storage)).toBe('a');
  });

  it('does not throw when storage refuses the write', () => {
    expect(() => recordProjectVisit(hostileStorage(), 'a')).not.toThrow();
  });
});

describe('readLastProject', () => {
  it('is null before any visit and after a hostile read', () => {
    expect(readLastProject(memoryStorage())).toBeNull();
    expect(readLastProject(memoryStorage({ [LAST_PROJECT_KEY]: '' }))).toBeNull();
    expect(readLastProject(hostileStorage())).toBeNull();
  });
});

// The table the rail paints from. Every state also has a word — a ring nobody
// can decode is not a status (spec §16).
describe('railRingState', () => {
  const signals = (over: Partial<Parameters<typeof railRingState>[1]> = {}) => ({
    runningProjectIds: new Set<string>(),
    blockingByProject: new Map<string, number>(),
    reachable: true,
    ...over,
  });

  it('is quiet with nothing running and nothing blocking', () => {
    expect(railRingState('p1', signals())).toBe('quiet');
  });

  it('is running when the project has a run in flight', () => {
    expect(railRingState('p1', signals({ runningProjectIds: new Set(['p1']) }))).toBe('running');
  });

  it('is needs-you when a blocking card names the project', () => {
    expect(railRingState('p1', signals({ blockingByProject: new Map([['p1', 2]]) }))).toBe(
      'needs-you',
    );
  });

  it('puts the human ahead of the agent: blocking outranks running', () => {
    expect(
      railRingState(
        'p1',
        signals({ runningProjectIds: new Set(['p1']), blockingByProject: new Map([['p1', 1]]) }),
      ),
    ).toBe('needs-you');
  });

  it('goes no-signal when the daemon is unreachable, whatever the last poll claimed', () => {
    expect(
      railRingState(
        'p1',
        signals({
          reachable: false,
          runningProjectIds: new Set(['p1']),
          blockingByProject: new Map([['p1', 3]]),
        }),
      ),
    ).toBe('no-signal');
  });

  it('counts zero blocking cards as zero, not as presence', () => {
    expect(railRingState('p1', signals({ blockingByProject: new Map([['p1', 0]]) }))).toBe('quiet');
  });

  it('gives every state a word, and the tooltip says the name and the word', () => {
    for (const state of ['running', 'needs-you', 'quiet', 'no-signal'] as const) {
      expect(RING_WORD[state]).toBeTruthy();
    }
    expect(railTooltip('Atlas', 'needs-you')).toBe('Atlas — needs you');
  });
});

describe('railOrder', () => {
  it('lists pinned first, then most-recently-visited', () => {
    const projects = [project('a'), project('b'), project('c', { pinned: true })];
    const { visible } = railOrder(projects, ['b', 'a']);
    expect(visible.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('shows projects a fresh browser has never visited rather than an empty rail', () => {
    const { visible } = railOrder([project('a'), project('b')], []);
    expect(visible.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('never repeats a project that is both pinned and recent', () => {
    const projects = [project('a', { pinned: true }), project('b')];
    const { visible } = railOrder(projects, ['a', 'b']);
    expect(visible.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('ignores recents whose project is gone', () => {
    const { visible } = railOrder([project('a')], ['ghost', 'a']);
    expect(visible.map((p) => p.id)).toEqual(['a']);
  });

  it('leaves archived and deleted projects off the rail entirely', () => {
    const projects = [
      project('a'),
      project('archived', { status: 'archived' }),
      project('gone', { deletedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    const { visible, overflow } = railOrder(projects, ['archived', 'gone']);
    expect(visible.map((p) => p.id)).toEqual(['a']);
    expect(overflow).toBe(0);
  });

  it('overflows past 8 into the +N chip, counting only what did not fit', () => {
    const projects = Array.from({ length: 11 }, (_, i) => project(`p${i}`));
    const { visible, overflow } = railOrder(projects, []);
    expect(visible).toHaveLength(RAIL_CAP);
    expect(overflow).toBe(3);
  });
});

// CONTRACTS-phase3 "Fixed shapes": Studio when design-shaped and no tasks yet;
// Build when it has tasks; Brief otherwise.
describe('defaultStagePath', () => {
  it('opens Build once a project has tasks, whatever its shape', () => {
    expect(defaultStagePath(project('p1', { shape: 'ui' }), true)).toBe('/projects/p1/board');
    expect(defaultStagePath(project('p1'), true)).toBe('/projects/p1/board');
  });

  it('opens Studio for a design-shaped project with no tasks yet', () => {
    expect(defaultStagePath(project('p1', { shape: 'ui' }), false)).toBe('/projects/p1/studio');
    expect(defaultStagePath(project('p1', { shape: 'mixed' }), false)).toBe('/projects/p1/studio');
  });

  it('opens Brief for everything else, including an unconfirmed shape', () => {
    expect(defaultStagePath(project('p1', { shape: 'headless' }), false)).toBe(
      '/projects/p1/brief',
    );
    expect(defaultStagePath(project('p1'), false)).toBe('/projects/p1/brief');
  });

  it('escapes the id so a crafted one cannot walk out of the project space', () => {
    expect(defaultStagePath(project('../settings'), false)).toBe('/projects/..%2Fsettings/brief');
  });
});

describe('stagesFor', () => {
  it('hides Studio for a project with no face — an unused stage is noise', () => {
    expect(stagesFor({ shape: 'headless' }).map((s) => s.key)).toEqual(['brief', 'build', 'proof']);
    expect(stagesFor({ shape: undefined }).map((s) => s.key)).toEqual(['brief', 'build', 'proof']);
  });

  it('keeps all four for a design-shaped project', () => {
    expect(stagesFor({ shape: 'ui' }).map((s) => s.key)).toEqual([
      'brief',
      'studio',
      'build',
      'proof',
    ]);
  });
});

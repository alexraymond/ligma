import type { DeckCard, DeckCardKind } from '@/hooks/use-deck-sources';
import type { InboxMessage } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_THRESHOLD,
  MACHINE_UNREACHABLE_ID,
  type TrayItem,
  type TrayStorage,
  WORKSPACE_GROUP,
  classifyTray,
  groupByProject,
  markSeen,
  readLastSeen,
  splitByLastSeen,
  trayItemId,
  trayItemProjectId,
  trayMode,
} from './needs-you';

function card(kind: DeckCardKind, id: string, createdAt = '2026-08-01T00:00:00.000Z'): DeckCard {
  return {
    id,
    kind,
    title: `${kind} ${id}`,
    context: '',
    options: [],
    evidence: null,
    href: '/deck',
    opensSheet: false,
    decision: null,
    projectId: null,
    createdAt,
  };
}

function message(
  id: string,
  status: InboxMessage['status'],
  createdAt = '2026-08-01T00:00:00.000Z',
): InboxMessage {
  return {
    id,
    from: 'developer',
    to: 'me',
    type: 'update',
    taskId: null,
    subject: `msg ${id}`,
    body: '',
    status,
    createdAt,
    readAt: status === 'unread' ? null : createdAt,
  };
}

function memoryStorage(): TrayStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('classifyTray', () => {
  it.each<[DeckCardKind, 'blocking' | 'fyi']>([
    ['decision', 'blocking'],
    ['design-approval', 'blocking'],
    ['promote-pending', 'blocking'],
    ['adoption-review', 'blocking'],
    ['run-blocked', 'blocking'],
    ['stale-brief', 'fyi'],
    ['verdict-spot-check', 'fyi'],
  ])('routes a %s card to %s', (kind, bucket) => {
    const { blocking, fyi } = classifyTray([card(kind, 'c1')], [], false);
    if (bucket === 'blocking') {
      expect(blocking.map(trayItemId)).toEqual(['c1']);
      expect(fyi).toHaveLength(0);
    } else {
      expect(fyi.map(trayItemId)).toEqual(['c1']);
      expect(blocking).toHaveLength(0);
    }
  });

  it('inserts the machine-unreachable item into blocking only when unreachable', () => {
    const reachable = classifyTray([], [], false);
    expect(reachable.blocking).toHaveLength(0);

    const unreachable = classifyTray([], [], true);
    expect(unreachable.blocking.map(trayItemId)).toEqual([MACHINE_UNREACHABLE_ID]);
  });

  it('includes unread inbox messages as FYI', () => {
    const { fyi } = classifyTray([], [message('m1', 'unread')], false);
    expect(fyi.map(trayItemId)).toEqual(['inbox:m1']);
  });

  it('never surfaces read or archived inbox messages', () => {
    const { fyi } = classifyTray([], [message('m1', 'read'), message('m2', 'archived')], false);
    expect(fyi).toHaveLength(0);
  });

  it('combines every source in one pass', () => {
    const cards = [card('decision', 'd1'), card('stale-brief', 'b1')];
    const messages = [message('m1', 'unread'), message('m2', 'read')];
    const { blocking, fyi } = classifyTray(cards, messages, true);
    expect(blocking.map(trayItemId).sort()).toEqual(['d1', MACHINE_UNREACHABLE_ID].sort());
    expect(fyi.map(trayItemId).sort()).toEqual(['b1', 'inbox:m1'].sort());
  });
});

describe('trayMode', () => {
  it('stays in focus mode right up to the threshold', () => {
    const seven = Array.from(
      { length: 7 },
      (_, i): TrayItem => ({ kind: 'card', card: card('decision', `c${i}`) }),
    );
    expect(trayMode(seven, [])).toBe('focus');
  });

  it('switches to list mode exactly at the threshold', () => {
    const eight = Array.from(
      { length: FOCUS_THRESHOLD },
      (_, i): TrayItem => ({
        kind: 'card',
        card: card('decision', `c${i}`),
      }),
    );
    expect(trayMode(eight, [])).toBe('list');
  });

  it('counts blocking and fyi together', () => {
    const blocking = Array.from(
      { length: 4 },
      (_, i): TrayItem => ({ kind: 'card', card: card('decision', `c${i}`) }),
    );
    const fyi = Array.from(
      { length: 4 },
      (_, i): TrayItem => ({ kind: 'card', card: card('stale-brief', `f${i}`) }),
    );
    expect(trayMode(blocking, fyi)).toBe('list');
  });
});

describe('splitByLastSeen', () => {
  const item = (id: string, createdAt: string): TrayItem => ({
    kind: 'card',
    card: card('decision', id, createdAt),
  });
  const machine: TrayItem = { kind: 'machine', id: MACHINE_UNREACHABLE_ID };

  it('splits fresh from earlier around the last-seen timestamp', () => {
    const items = [
      item('old', '2026-08-01T00:00:00.000Z'),
      item('new', '2026-08-10T00:00:00.000Z'),
    ];
    const { fresh, earlier } = splitByLastSeen(items, '2026-08-05T00:00:00.000Z');
    expect(fresh.map(trayItemId)).toEqual(['new']);
    expect(earlier.map(trayItemId)).toEqual(['old']);
  });

  it('puts an item with no createdAt in earlier even when everything else is fresh', () => {
    const items = [machine, item('new', '2026-08-10T00:00:00.000Z')];
    const { fresh, earlier } = splitByLastSeen(items, '2026-08-05T00:00:00.000Z');
    expect(fresh.map(trayItemId)).toEqual(['new']);
    expect(earlier.map(trayItemId)).toEqual([MACHINE_UNREACHABLE_ID]);
  });

  it('disables the divider — everything is earlier — when lastSeenAt is null', () => {
    const items = [item('a', '2026-08-10T00:00:00.000Z')];
    const { fresh, earlier } = splitByLastSeen(items, null);
    expect(fresh).toHaveLength(0);
    expect(earlier.map(trayItemId)).toEqual(['a']);
  });

  it('disables the divider when lastSeenAt is unparseable', () => {
    const items = [item('a', '2026-08-10T00:00:00.000Z')];
    const { fresh, earlier } = splitByLastSeen(items, 'not-a-date');
    expect(fresh).toHaveLength(0);
    expect(earlier.map(trayItemId)).toEqual(['a']);
  });
});

describe('trayItemProjectId', () => {
  const noTask = () => null;

  it("reads a card's own projectId", () => {
    const c = card('decision', 'c1');
    c.projectId = 'proj-1';
    expect(trayItemProjectId({ kind: 'card', card: c }, noTask)).toBe('proj-1');
  });

  it("resolves an inbox message's project through its task", () => {
    const item: TrayItem = { kind: 'inbox', message: { ...message('m1', 'unread'), taskId: 't1' } };
    expect(trayItemProjectId(item, (taskId) => (taskId === 't1' ? 'proj-2' : null))).toBe('proj-2');
  });

  it('is null for an inbox message with no task', () => {
    const item: TrayItem = { kind: 'inbox', message: message('m1', 'unread') };
    expect(trayItemProjectId(item, noTask)).toBeNull();
  });

  it('is always null for the machine item', () => {
    const item: TrayItem = { kind: 'machine', id: MACHINE_UNREACHABLE_ID };
    expect(trayItemProjectId(item, noTask)).toBeNull();
  });
});

describe('groupByProject', () => {
  const nameOf = (id: string | null) =>
    id === 'proj-1' ? 'Zeta' : id === 'proj-2' ? 'Alpha' : WORKSPACE_GROUP;

  it('groups items under their resolved project name', () => {
    const items = [
      { projectId: 'proj-1' as string | null },
      { projectId: 'proj-2' as string | null },
      { projectId: 'proj-1' as string | null },
    ];
    const groups = groupByProject(items, (i) => i.projectId, nameOf);
    expect(groups.map(([name, group]) => [name, group.length])).toEqual([
      ['Alpha', 1],
      ['Zeta', 2],
    ]);
  });

  it('sorts named projects alphabetically with Workspace always last', () => {
    const items = [
      { projectId: null as string | null },
      { projectId: 'proj-1' as string | null },
      { projectId: 'proj-2' as string | null },
    ];
    const groups = groupByProject(items, (i) => i.projectId, nameOf);
    expect(groups.map(([name]) => name)).toEqual(['Alpha', 'Zeta', WORKSPACE_GROUP]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByProject([], (i: { projectId: string | null }) => i.projectId, nameOf)).toEqual(
      [],
    );
  });
});

describe('readLastSeen / markSeen', () => {
  it('is null until marked', () => {
    const storage = memoryStorage();
    expect(readLastSeen(storage)).toBeNull();
  });

  it('round-trips the timestamp it was marked with', () => {
    const storage = memoryStorage();
    markSeen(storage, '2026-08-12T09:00:00.000Z');
    expect(readLastSeen(storage)).toBe('2026-08-12T09:00:00.000Z');
  });

  it("uses its own key, not the onboarding hint's", () => {
    const storage = memoryStorage();
    markSeen(storage, '2026-08-12T09:00:00.000Z');
    expect(storage.getItem('mc-onboarded')).toBeNull();
  });
});

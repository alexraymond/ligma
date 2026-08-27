/**
 * drop-notes-field.ts — a planted defect for the harness's own acceptance test.
 *
 * The whole point of this harness is to catch what unit tests wave through. So
 * the defect is chosen to be invisible to the suite: the task-create API keeps
 * accepting and validating `notes`, then silently discards it. Nothing crashes,
 * no type changes, no test asserts that notes survive a POST /api/tasks, and the
 * UI happily renders an empty notes field.
 *
 * A user, on the other hand, notices immediately: they typed a note, reopened the
 * task, and it is gone. That asymmetry is the thing being demonstrated.
 *
 * Applied by createEnv({ mutate }) to a throwaway worktree — never to the repo.
 *
 * The path below is the POST-REBRAND one. It used to point at
 * `<worktree>/mission-control/src/app/api/tasks/route.ts`, a directory the
 * rebrand removed, so the one mutation the harness ships threw before it could
 * plant anything.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The one assignment that carries the user's note into the stored task. */
const TARGET = '      notes: body.notes,';
const REPLACEMENT =
  '      notes: "", // PLANTED DEFECT (harness acceptance test): the note is dropped';

export default function dropNotesField(worktreePath: string): void {
  const route = path.join(worktreePath, 'apps', 'daemon', 'src', 'routes', 'tasks', 'route.ts');
  const source = readFileSync(route, 'utf-8');

  const occurrences = source.split(TARGET).length - 1;
  if (occurrences !== 1) {
    // Loud: a silently-unapplied mutation would make the acceptance test a lie.
    throw new Error(
      `drop-notes-field expected exactly one \`${TARGET.trim()}\` in ${route}, found ${occurrences}. The seam moved — re-read the POST handler and update TARGET.`,
    );
  }

  writeFileSync(route, source.replace(TARGET, REPLACEMENT), 'utf-8');
  console.log(`[mutation] drop-notes-field applied to ${route}`);
}

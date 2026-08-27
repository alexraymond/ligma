/**
 * migrate-verification-status.ts — one-shot, idempotent backfill.
 *
 * Every task missing `verificationStatus` gets "unverified". Nothing else changes:
 * kanban stays put (208 legacy "done" tasks keep saying done — this migration only
 * records that none of them were ever verified).
 *
 * Usage: node --import tsx scripts/migrate-verification-status.ts
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { withFileLock } from "../src/engine/file-lock";

import { DATA_DIR } from "../src/paths";
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

const migrated = withFileLock("tasks", () => {
  const data = JSON.parse(readFileSync(TASKS_FILE, "utf-8")) as {
    tasks: Array<Record<string, unknown>>;
  };

  let count = 0;
  data.tasks = data.tasks.map((task) => {
    if (task.verificationStatus !== undefined) return task;
    count++;
    // Rebuild in place so the new key lands next to `kanban` instead of at the end.
    const rebuilt = Object.fromEntries(
      Object.entries(task).flatMap(([k, v]) =>
        k === "kanban" ? [[k, v], ["verificationStatus", "unverified"]] : [[k, v]]
      )
    );
    rebuilt.verificationStatus ??= "unverified"; // task had no `kanban` key at all
    return rebuilt;
  });

  if (count > 0) {
    writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
  return { count, total: data.tasks.length };
});

console.log(
  `migrate-verification-status: ${migrated.count} of ${migrated.total} tasks backfilled with verificationStatus="unverified"`
);

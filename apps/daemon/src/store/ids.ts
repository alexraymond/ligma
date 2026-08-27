import { nanoid } from 'nanoid';

/** Generate a collision-proof ID with a prefix (e.g., "task", "goal", "proj") */
export function generateId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
}

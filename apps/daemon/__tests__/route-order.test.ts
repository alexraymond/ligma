import { API_ROUTES } from '@ligma/api';
/**
 * Walkthrough B2: apiRouter() used to sort routes by raw path-string length as
 * a specificity proxy, so `/api/references/:id/:refId` (26 chars, DELETE-only)
 * registered ahead of `/api/references/:id/notes` (25 chars) and 405'd every
 * Notes tab — Express matches the first pattern that fits, and a `:refId`
 * param matches the literal "notes" just fine.
 *
 * `bySpecificity` fixes the comparator (fewest dynamic params first, then most
 * literal segments, then length as a last-resort tie-break). This scripts
 * every currently-registered route through it and asserts no route ever
 * shadows a route that comes after it, so the next short literal segment
 * can't regress the same way.
 */
import { describe, expect, it } from 'vitest';
import { bySpecificity, routeSpecificity } from '../src/routes';

const routes = Object.values(API_ROUTES);
const sorted = [...routes].sort(bySpecificity);

/** A concrete URL `pattern` could produce, for testing whether another pattern matches it. */
function sampleUrl(pattern: string): string {
  return pattern.replace(/:(\w+)/g, 'sample-value');
}

/** Does `pattern` match every URL `other` can produce (same shape, and would swallow it if registered first)? */
function shadows(pattern: string, other: string): boolean {
  if (pattern === other) return false;
  const patternSegs = pattern.split('/');
  const otherSegs = sampleUrl(other).split('/');
  if (patternSegs.length !== otherSegs.length) return false;
  return patternSegs.every((seg, i) => seg.startsWith(':') || seg === otherSegs[i]);
}

describe('apiRouter route ordering', () => {
  it('orders the known Notes-vs-ref collision with the literal route first', () => {
    const notesIndex = sorted.indexOf(API_ROUTES.referencesNotes);
    const refIndex = sorted.indexOf(API_ROUTES.referencesRef);
    expect(notesIndex).toBeGreaterThanOrEqual(0);
    expect(notesIndex).toBeLessThan(refIndex);
  });

  it('never registers a route ahead of one it would shadow', () => {
    const collisions: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (shadows(sorted[i], sorted[j])) {
          collisions.push(`"${sorted[i]}" (index ${i}) would shadow "${sorted[j]}" (index ${j})`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('still prefers more literal segments over fewer when param counts tie', () => {
    // Regression guard for the pre-existing invariant ("/api/tasks/archive"
    // must not be eaten by "/api/tasks") the old length-based sort also held.
    expect(routeSpecificity('/api/tasks/archive').literals).toBeGreaterThan(
      routeSpecificity('/api/tasks').literals,
    );
    const archiveIndex = sorted.indexOf(API_ROUTES.tasksArchive);
    const tasksIndex = sorted.indexOf(API_ROUTES.tasks);
    expect(archiveIndex).toBeLessThan(tasksIndex);
  });
});

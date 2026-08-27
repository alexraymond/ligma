/**
 * Shared lookups for the per-project routes (knowledge, journeys, baselines).
 *
 * Every one of them needs the same two things: the project row, and the repo
 * path its `.ligma/` lives under. A project with no repoPath is not an error —
 * it is a project that is not a codebase — so the callers get a typed "no repo"
 * answer rather than an exception to translate.
 */

import type { Project } from '@ligma/api';
import { NextResponse } from '../../../http';
import { getProjects } from '../../../store/data';

export async function findProject(id: string): Promise<Project | null> {
  const data = await getProjects();
  return data.projects.find((p) => p.id === id && !p.deletedAt) ?? null;
}

export type RepoLookup =
  | { ok: true; project: Project; repoPath: string }
  | { ok: false; response: Response };

/** The project AND its repo, or the 404/409 to return instead. */
export async function requireRepo(id: string): Promise<RepoLookup> {
  const project = await findProject(id);
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
    };
  }
  if (!project.repoPath) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Project has no repoPath — set one with PATCH /api/projects/:id before using .ligma/',
        },
        { status: 409 },
      ),
    };
  }
  return { ok: true, project, repoPath: project.repoPath };
}

export function badRequest(err: unknown): Response {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: 400 },
  );
}

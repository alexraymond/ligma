import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@ligma/api';
import { NextResponse } from '../../http';
import { CENTRAL_PROJECTS_DIR } from '../../paths';
import { getProjects, mutateGoals, mutateProjects, mutateTasks } from '../../store/data';
import { generateId } from '../../store/ids';
import {
  DEFAULT_LIMIT,
  projectCreateSchema,
  projectUpdateSchema,
  validateBody,
} from '../../store/validations';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');
  const includeDeleted = searchParams.get('includeDeleted') === 'true';

  const data = await getProjects();
  const total = data.projects.length;

  // Ensure backward compatibility for new fields
  let projects = data.projects.map((p) => ({
    ...p,
    teamMembers: p.teamMembers ?? [],
  }));

  // Filter out soft-deleted by default
  if (!includeDeleted) {
    projects = projects.filter((p) => !p.deletedAt);
  }

  if (id) {
    projects = projects.filter((p) => p.id === id);
  }
  if (status) {
    projects = projects.filter((p) => p.status === status);
  }

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = projects.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  projects = projects.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: projects,
      projects,
      meta: { total, filtered: totalFiltered, returned: projects.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, projectCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newProject = await mutateProjects(async (data) => {
    const project: Project = {
      id: generateId('proj'),
      name: body.name,
      description: body.description,
      status: body.status,
      color: body.color,
      teamMembers: body.teamMembers,
      createdAt: new Date().toISOString(),
      tags: body.tags,
      deletedAt: null,
      repoPath: body.repoPath ?? null,
      ...(body.shape ? { shape: body.shape } : {}),
    };
    data.projects.push(project);
    return project;
  });

  return NextResponse.json(newProject, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, projectUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const updated = await mutateProjects(async (data) => {
    const idx = data.projects.findIndex((p) => p.id === body.id);
    if (idx === -1) return null;
    data.projects[idx] = { ...data.projects[idx], ...body };
    return data.projects[idx];
  });

  if (!updated) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const hard = searchParams.get('hard') === 'true';

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  if (hard) {
    // Hard delete: remove the row AND the central data the project accumulated
    // — baselines, designs, probes, evidence pins, the brief. Both happen under
    // the projects mutex, so the row and its directory go away together; if the
    // rm throws, the callback throws and the row is not written away either.
    //
    // What is NOT deleted is the product's own repo. Alex's code is not ours to
    // delete, so its path is reported back instead.
    const removed = await mutateProjects(async (data) => {
      const idx = data.projects.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      const [project] = data.projects.splice(idx, 1);
      await rm(path.join(CENTRAL_PROJECTS_DIR, path.basename(project.id)), {
        recursive: true,
        force: true,
      });
      return project;
    });

    if (!removed) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Referential integrity: clear projectId on tasks and goals that referenced this project
    await mutateTasks(async (data) => {
      for (const task of data.tasks) {
        if (task.projectId === id) {
          task.projectId = null;
        }
      }
    });

    await mutateGoals(async (data) => {
      for (const goal of data.goals) {
        if (goal.projectId === id) {
          goal.projectId = null;
        }
      }
    });

    return NextResponse.json({
      ok: true,
      hard: true,
      /** Left on disk on purpose — the product's code outlives its project row. */
      productRepoPath: removed.repoPath ?? null,
    });
  }

  // Soft delete: set deletedAt timestamp
  const found = await mutateProjects(async (data) => {
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    data.projects[idx].deletedAt = new Date().toISOString();
    return true;
  });

  if (!found) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, hard: false });
}

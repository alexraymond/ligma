import type { AgentDefinition } from '@ligma/api';
import { NextResponse } from '../../http';
import { getAgents, mutateAgents, mutateSkillsLibrary, mutateTasks } from '../../store/data';
import { syncAgentCommand } from '../../store/sync-commands';
import {
  DEFAULT_LIMIT,
  agentCreateSchema,
  agentUpdateSchema,
  validateBody,
} from '../../store/validations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');

  const data = await getAgents();
  const total = data.agents.length;
  let agents = data.agents;

  if (id) {
    agents = agents.filter((a) => a.id === id);
  }
  if (status) {
    agents = agents.filter((a) => a.status === status);
  }

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = agents.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  agents = agents.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: agents,
      agents,
      meta: { total, filtered: totalFiltered, returned: agents.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, agentCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newAgent = await mutateAgents(async (data) => {
    // Check for duplicate ID
    if (data.agents.some((a) => a.id === body.id)) {
      return null;
    }

    const now = new Date().toISOString();
    const agent: AgentDefinition = {
      id: body.id,
      name: body.name,
      icon: body.icon,
      description: body.description,
      instructions: body.instructions,
      capabilities: body.capabilities,
      skillIds: body.skillIds,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    data.agents.push(agent);
    return agent;
  });

  if (!newAgent) {
    return NextResponse.json(
      { error: `Agent with id "${body.id}" already exists` },
      { status: 409 },
    );
  }

  // Side effect: regenerate command file
  try {
    await syncAgentCommand(newAgent);
  } catch {
    // Non-fatal: command sync failure shouldn't break the API
  }

  return NextResponse.json(newAgent, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, agentUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const updatedAgent = await mutateAgents(async (data) => {
    const idx = data.agents.findIndex((a) => a.id === body.id);
    if (idx === -1) {
      return null;
    }

    data.agents[idx] = {
      ...data.agents[idx],
      ...body,
      updatedAt: new Date().toISOString(),
    };
    return data.agents[idx];
  });

  if (!updatedAgent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Side effect: regenerate command file
  try {
    await syncAgentCommand(updatedAgent);
  } catch {
    // Non-fatal
  }

  return NextResponse.json(updatedAgent);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const hard = searchParams.get('hard') === 'true';
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Built-in agents can't be hard-deleted, only deactivated
  const builtIn = ['me', 'researcher', 'developer', 'marketer', 'business-analyst'];
  if (builtIn.includes(id) && !hard) {
    // Soft delete: set status to inactive
    const result = await mutateAgents(async (data) => {
      const idx = data.agents.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      data.agents[idx] = {
        ...data.agents[idx],
        status: 'inactive',
        updatedAt: new Date().toISOString(),
      };
      return true;
    });
    if (!result) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, softDeleted: true });
  }

  // Hard delete (non-builtin, or builtin with ?hard=true — though builtins still just deactivate)
  if (builtIn.includes(id)) {
    // Built-in agents: always soft-delete even with hard=true
    const result = await mutateAgents(async (data) => {
      const idx = data.agents.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      data.agents[idx] = {
        ...data.agents[idx],
        status: 'inactive',
        updatedAt: new Date().toISOString(),
      };
      return true;
    });
    if (!result) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, softDeleted: true });
  }

  // Non-builtin agent: hard delete
  await mutateAgents(async (data) => {
    data.agents = data.agents.filter((a) => a.id !== id);
  });

  // Clean up references in tasks (assignedTo + collaborators)
  await mutateTasks(async (data) => {
    for (const task of data.tasks) {
      if (task.assignedTo === id) {
        task.assignedTo = null;
        task.updatedAt = new Date().toISOString();
      }
      if (task.collaborators.includes(id)) {
        task.collaborators = task.collaborators.filter((c) => c !== id);
        task.updatedAt = new Date().toISOString();
      }
    }
  });

  // Clean up agentIds in skills
  await mutateSkillsLibrary(async (data) => {
    for (const skill of data.skills) {
      if (skill.agentIds.includes(id)) {
        skill.agentIds = skill.agentIds.filter((a) => a !== id);
        skill.updatedAt = new Date().toISOString();
      }
    }
  });

  return NextResponse.json({ ok: true });
}

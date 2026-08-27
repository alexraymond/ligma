import type { SkillDefinition } from '@ligma/api';
import { NextResponse } from '../../http';
import { getAgents, getSkillsLibrary, mutateSkillsLibrary } from '../../store/data';
import { generateId } from '../../store/ids';
import { syncAgentCommand, syncSkillFile } from '../../store/sync-commands';
import {
  DEFAULT_LIMIT,
  skillCreateSchema,
  skillUpdateSchema,
  validateBody,
} from '../../store/validations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const agentId = searchParams.get('agentId');

  const data = await getSkillsLibrary();
  const total = data.skills.length;
  let skills = data.skills;

  if (id) {
    skills = skills.filter((s) => s.id === id);
  }
  if (agentId) {
    skills = skills.filter((s) => s.agentIds.includes(agentId));
  }

  // Pagination
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const totalFiltered = skills.length;
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : DEFAULT_LIMIT;
  const offset = Math.max(0, Number.parseInt(offsetParam ?? '0', 10));
  skills = skills.slice(offset, offset + limit);

  return NextResponse.json(
    {
      data: skills,
      skills,
      meta: { total, filtered: totalFiltered, returned: skills.length, limit, offset },
    },
    { headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=5' } },
  );
}

export async function POST(request: Request) {
  const validation = await validateBody(request, skillCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const newSkill = await mutateSkillsLibrary(async (data) => {
    const now = new Date().toISOString();
    const skill: SkillDefinition = {
      id: body.id || generateId('skill'),
      name: body.name,
      description: body.description,
      content: body.content,
      agentIds: body.agentIds,
      tags: body.tags,
      createdAt: now,
      updatedAt: now,
    };

    // Check for duplicate ID
    if (data.skills.some((s) => s.id === skill.id)) {
      return null;
    }

    data.skills.push(skill);
    return skill;
  });

  if (!newSkill) {
    return NextResponse.json(
      { error: `Skill with id "${body.id || '(generated)'}" already exists` },
      { status: 409 },
    );
  }

  // Side effects: regenerate skill file + re-sync affected agent commands
  try {
    await syncSkillFile(newSkill);
    // Re-sync command files for agents linked to this skill
    const agentsData = await getAgents();
    for (const agent of agentsData.agents) {
      if (agent.status === 'active' && newSkill.agentIds.includes(agent.id)) {
        await syncAgentCommand(agent);
      }
    }
  } catch {
    // Non-fatal: sync failure shouldn't break the API
  }

  return NextResponse.json(newSkill, { status: 201 });
}

export async function PUT(request: Request) {
  const validation = await validateBody(request, skillUpdateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const result = await mutateSkillsLibrary(async (data) => {
    const idx = data.skills.findIndex((s) => s.id === body.id);
    if (idx === -1) {
      return null;
    }

    const previousAgentIds = data.skills[idx].agentIds;
    data.skills[idx] = {
      ...data.skills[idx],
      ...body,
      updatedAt: new Date().toISOString(),
    };
    return { updatedSkill: data.skills[idx], previousAgentIds };
  });

  if (!result) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
  }

  const { updatedSkill, previousAgentIds } = result;

  // Side effects: regenerate skill file + re-sync affected agent commands
  try {
    await syncSkillFile(updatedSkill);
    // Re-sync agents that were linked before OR after the update
    const affectedAgentIds = new Set([...previousAgentIds, ...updatedSkill.agentIds]);
    const agentsData = await getAgents();
    for (const agent of agentsData.agents) {
      if (agent.status === 'active' && affectedAgentIds.has(agent.id)) {
        await syncAgentCommand(agent);
      }
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json(updatedSkill);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const deletedSkill = await mutateSkillsLibrary(async (data) => {
    const skill = data.skills.find((s) => s.id === id);
    data.skills = data.skills.filter((s) => s.id !== id);
    return skill ?? null;
  });

  // `{ok:true}` for an id that was never there claimed a delete that did not
  // happen (codebase audit R8).
  if (!deletedSkill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

  // Side effect: re-sync agent commands that referenced the deleted skill
  try {
    const agentsData = await getAgents();
    for (const agent of agentsData.agents) {
      const wasLinked = agent.skillIds.includes(id) || deletedSkill.agentIds.includes(agent.id);
      if (agent.status === 'active' && wasLinked) {
        await syncAgentCommand(agent);
      }
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true });
}

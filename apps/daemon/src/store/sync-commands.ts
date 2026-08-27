import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition, SkillDefinition } from '@ligma/api';
import { getAgents, getSkillsLibrary } from './data';

import { WORKSPACE_ROOT } from '../paths';
import { authoredSkillsRoot } from '../routes/skill-catalog/route';
const COMMANDS_DIR = path.join(WORKSPACE_ROOT, '.claude', 'commands');

// ─── Agent Command Generation ──────────────────────────────────────────────

export function generateAgentCommandMarkdown(
  agent: AgentDefinition,
  linkedSkills: SkillDefinition[],
): string {
  const lines: string[] = [];

  lines.push(`You are acting as a ${agent.name} — ${agent.description}.`);
  lines.push('');

  if (agent.instructions) {
    lines.push('## Your Instructions');
    lines.push(agent.instructions);
    lines.push('');
  }

  if (agent.capabilities.length > 0) {
    lines.push('## Your Capabilities');
    for (const cap of agent.capabilities) {
      lines.push(`- ${cap}`);
    }
    lines.push('');
  }

  if (linkedSkills.length > 0) {
    lines.push('## Your Skills');
    lines.push('');
    for (const skill of linkedSkills) {
      lines.push(`### ${skill.name}`);
      lines.push(skill.content);
      lines.push('');
    }
  }

  lines.push('## Standard Operating Procedures');
  lines.push('1. Read `ligma/data/ai-context.md` for current state');
  lines.push(`2. Check inbox for messages addressed to you: filter \`to: "${agent.id}"\``);
  lines.push(`3. Work on assigned tasks (check \`assignedTo: "${agent.id}"\`)`);
  lines.push('4. Post completion reports to inbox when done');
  lines.push('5. Log activity events for significant actions');
  lines.push('6. Run `pnpm gen:context` after modifying data files');

  return lines.join('\n');
}

/**
 * Resolves all skills linked to an agent from both directions:
 * 1. Skills referenced in the agent's `skillIds` array
 * 2. Skills that list the agent in their `agentIds` array
 * Returns deduplicated skills in stable order.
 */
export function resolveLinkedSkills(
  agent: AgentDefinition,
  allSkills: SkillDefinition[],
): SkillDefinition[] {
  const seen = new Set<string>();
  const result: SkillDefinition[] = [];

  for (const skill of allSkills) {
    const linkedByAgent = agent.skillIds.includes(skill.id);
    const linkedBySkill = skill.agentIds.includes(agent.id);
    if ((linkedByAgent || linkedBySkill) && !seen.has(skill.id)) {
      seen.add(skill.id);
      result.push(skill);
    }
  }

  return result;
}

/**
 * Writes/updates `.claude/commands/<agent.id>/user.md` from agent data.
 * Skills are resolved from both directions: agent.skillIds and skill.agentIds.
 */
export async function syncAgentCommand(agent: AgentDefinition): Promise<void> {
  // Skip "me" — no command file needed for the human
  if (agent.id === 'me') return;

  const skillsData = await getSkillsLibrary();
  const linkedSkills = resolveLinkedSkills(agent, skillsData.skills);

  const content = generateAgentCommandMarkdown(agent, linkedSkills);
  const dir = path.join(COMMANDS_DIR, agent.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'user.md'), content, 'utf-8');
}

/**
 * Syncs all active agent commands from the registry.
 */
export async function syncAllAgentCommands(): Promise<void> {
  const data = await getAgents();
  for (const agent of data.agents) {
    if (agent.status === 'active') {
      await syncAgentCommand(agent);
    }
  }
}

// ─── Skill File Generation ──────────────────────────────────────────────────

function generateSkillFileContent(skill: SkillDefinition): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${skill.id}`);
  lines.push('description: >');
  lines.push(`  ${skill.description}`);
  lines.push('---');
  lines.push('');
  lines.push(skill.content);
  return lines.join('\n');
}

/**
 * Writes/updates `<DATA_DIR>/skills/<skill.id>/SKILL.md` from skill data.
 *
 * The store, not the checkout and not `WORKSPACE_ROOT/skills` (where this used
 * to write): an authored skill is the user's data. `/api/skill-catalog` reads
 * this root overlaid on the vendored one, so a skill written here is a skill
 * the catalog and the studio's `@`-mentions can see.
 *
 * Migration: skills authored before the move wrote to `WORKSPACE_ROOT/skills`
 * (`~/skills`), a directory nothing ever read back. `skills-library.json` is
 * the source of truth for every one of them, so `POST /api/sync` rewrites the
 * lot into the new root and the old directory is stale — delete it by hand.
 */
export async function syncSkillFile(skill: SkillDefinition): Promise<void> {
  // The id becomes a directory name. Validated at the write routes too
  // (skillCreate/UpdateSchema), but checked here as well because this is the
  // one function every caller — routes, bulk resync, legacy rows already on
  // disk — routes through (codebase audit R2).
  if (!/^[A-Za-z0-9_-]+$/.test(skill.id)) {
    throw new Error(`Unsafe skill id "${skill.id}" — must match /^[A-Za-z0-9_-]+$/`);
  }
  const content = generateSkillFileContent(skill);
  const dir = path.join(authoredSkillsRoot(), skill.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

/**
 * Syncs all skill files from the library.
 */
export async function syncAllSkillFiles(): Promise<void> {
  const data = await getSkillsLibrary();
  for (const skill of data.skills) {
    await syncSkillFile(skill);
  }
}

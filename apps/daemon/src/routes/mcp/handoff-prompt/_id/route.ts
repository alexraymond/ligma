/**
 * GET /api/mcp/handoff-prompt/:id — compiles a copy-paste prompt handing this
 * project's context to an external coding agent (OD-104/OD-100).
 *
 * Project-scoped only: this hands ONE project to an external agent, so it must
 * never carry facts about any other project (or the workspace as a whole).
 */
import { NextResponse } from '../../../../http';
import { getProjects, getTasks } from '../../../../store/data';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { projects } = await getProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { tasks } = await getTasks();
  const projectTasks = tasks.filter((t) => t.projectId === id && !t.deletedAt);

  const lines = [
    `# Ligma handoff — ${project.name}`,
    '',
    `Project: ${project.name} (${project.id})`,
    `Status: ${project.status}`,
    project.repoPath ? `Repo: ${project.repoPath}` : 'Repo: none (not a codebase project)',
  ];
  if (project.description) lines.push(`Description: ${project.description}`);

  lines.push('', `## Open tasks (${projectTasks.length})`);
  lines.push(
    ...(projectTasks.length > 0
      ? projectTasks.map((t) => `- ${t.id}: ${t.title} [${t.kanban}]`)
      : ['- none']),
  );

  lines.push(
    '',
    '## Notes for the external agent',
    '- This handoff only compiles context; it does not register your session with ligma.',
    "- If ligma's MCP server is running (apps/daemon/src/mcp-server.ts), use its tools to check task/decision/run status as you work.",
  );

  return NextResponse.json({
    prompt: lines.join('\n'),
    vscodeUrl: project.repoPath ? `vscode://file/${project.repoPath}` : null,
  });
}

/**
 * GET/POST /api/mcp/servers — the external MCP server registry (OD-101).
 *
 * Registration only: adding a server here does not launch it, probe it, or
 * attach it to any agent run. Wiring a registered server into an actual agent
 * spawn is a runner concern, and is explicitly out of scope for this route —
 * see the Integrations page copy (apps/web/src/app/settings/integrations).
 */
import { NextResponse } from '../../../http';
import { generateId } from '../../../store/ids';
import { validateBody } from '../../../store/validations';
import { type McpServerEntry, getMcpServers, mutateMcpServers } from '../store';
import { mcpServerCreateSchema } from '../validations';

export async function GET() {
  const data = await getMcpServers();
  return NextResponse.json({ servers: data.servers });
}

export async function POST(request: Request) {
  const validation = await validateBody(request, mcpServerCreateSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const server = await mutateMcpServers((data) => {
    const entry: McpServerEntry = {
      id: generateId('mcpsrv'),
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      url: body.url,
      enabled: body.enabled,
      createdAt: new Date().toISOString(),
    };
    data.servers.push(entry);
    return entry;
  });

  return NextResponse.json(server, { status: 201 });
}

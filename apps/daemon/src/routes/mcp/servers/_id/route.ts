/**
 * GET/PATCH/DELETE /api/mcp/servers/:id — one external MCP registry entry.
 */
import { NextResponse } from '../../../../http';
import { validateBody } from '../../../../store/validations';
import { getMcpServers, mutateMcpServers } from '../../store';
import { mcpServerUpdateSchema } from '../../validations';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getMcpServers();
  const server = data.servers.find((s) => s.id === id);
  if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });
  return NextResponse.json(server);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validation = await validateBody(request, mcpServerUpdateSchema);
  if (!validation.success) return validation.error;

  const updated = await mutateMcpServers((data) => {
    const server = data.servers.find((s) => s.id === id);
    if (!server) return null;
    Object.assign(server, validation.data);
    return server;
  });

  if (!updated) return NextResponse.json({ error: 'Server not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removed = await mutateMcpServers((data) => {
    const idx = data.servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    data.servers.splice(idx, 1);
    return true;
  });

  if (!removed) return NextResponse.json({ error: 'Server not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { HandoffCard } from './handoff-card';
import { McpRegistryCard } from './mcp-registry-card';
import { McpServerCard } from './mcp-server-card';

/**
 * Integrations (OD-064, OD-101, OD-104, OD-014, OD-100) — single-user
 * localhost posture, so no auth/multi-tenant concerns here.
 *
 * Linked from apps/web/src/app/settings/page.tsx.
 */
export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <BreadcrumbNav
        items={[{ label: 'Settings', href: '/settings' }, { label: 'Integrations' }]}
      />

      <div>
        <h1 className="text-xl font-bold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Run ligma as an MCP server for external coding agents, register external MCP servers, and
          hand off projects to other agents.
        </p>
      </div>

      <McpServerCard />
      <McpRegistryCard />
      <HandoffCard />
    </div>
  );
}

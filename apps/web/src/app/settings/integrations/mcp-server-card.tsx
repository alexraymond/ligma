'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Ligma as an MCP server (OD-064/OD-014).
 *
 * `apps/daemon/src/mcp-server.ts` is a stdio entrypoint an external coding
 * agent (Claude Code, etc.) can launch directly — this card is read-only
 * copy-paste help for pointing one at it, not a live daemon connection: the
 * daemon itself doesn't run this process, the external agent does.
 */

const RUN_COMMAND = 'pnpm --filter @ligma/daemon mcp:server';

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "ligma": {
      "command": "pnpm",
      "args": ["--filter", "@ligma/daemon", "mcp:server"]
    }
  }
}`;

const TOOLS: { name: string; description: string }[] = [
  { name: 'list_projects', description: 'List projects, optionally filtered by status.' },
  {
    name: 'create_project',
    description: 'Create a bare project record (name, description, repo path, tags).',
  },
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by project or kanban column.',
  },
  { name: 'list_decisions', description: 'List decisions, optionally filtered by status.' },
  { name: 'answer_decision', description: 'Answer a pending decision by id.' },
  { name: 'get_run_status', description: "Get one run's status by id, or every run." },
];

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Could not copy — your browser blocked clipboard access');
  }
}

export function McpServerCard() {
  const [showConfig, setShowConfig] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Ligma as an MCP server
        </CardTitle>
        <CardDescription className="mt-1.5">
          A small, honest toolset over ligma&apos;s own routes — list/create projects, list tasks,
          list/answer decisions, check run status. Point any MCP-capable coding agent at it over
          stdio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
            {RUN_COMMAND}
          </code>
          <Button variant="outline" size="sm" onClick={() => copy(RUN_COMMAND, 'Command')}>
            Copy
          </Button>
        </div>

        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs underline underline-offset-2"
            onClick={() => setShowConfig((v) => !v)}
          >
            {showConfig ? 'Hide' : 'Show'} MCP client config snippet
          </Button>
          {showConfig && (
            <div className="mt-2 flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {MCP_CONFIG_SNIPPET}
              </pre>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(MCP_CONFIG_SNIPPET, 'Config')}
              >
                Copy
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Tools exposed</p>
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:gap-2"
            >
              <code className="font-mono font-medium">{tool.name}</code>
              <span className="text-muted-foreground">{tool.description}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

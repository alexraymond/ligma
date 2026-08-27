// Content fixtures for the "Use ligma everywhere" guide modal.
//
// Kept as a plain data module (no React imports) so it's testable under the
// same node-environment vitest config as the rest of apps/web, and so the
// UseEverywhereModal component stays thin (render + copy-to-clipboard only).
//
// Every route path and CLI command below is verified against this repo:
//   - apps/cli/src/cli.ts (the only commands `ligma` actually understands)
//   - packages/api/src/routes.ts (API_ROUTES — the daemon's real HTTP surface)
//   - apps/daemon/src/mcp-server.ts (the daemon's real stdio MCP server — six
//     tools, each wrapping the same route handler the HTTP API calls)

export interface CodeSnippet {
  /** Tag shown above the snippet in the UI. */
  label: string;
  /** Language hint (used for syntax highlighting + `<pre data-language>`). */
  language: 'bash' | 'json';
  /** Source body. Multi-line allowed; no leading/trailing blank lines. */
  body: string;
}

export interface GuideSection {
  /** Stable id used as the React tab key. */
  id: 'overview' | 'cli' | 'http' | 'mcp';
  /** Short tab label. */
  tabLabel: string;
  /** Section heading inside the body. */
  heading: string;
  /** One-paragraph intro under the heading. */
  intro: string;
  /** Bulleted highlights. */
  bullets: string[];
  /** Ordered code snippets. */
  snippets: CodeSnippet[];
  /** Optional muted footer line. */
  footer?: string;
}

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4477';

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'overview',
    tabLabel: 'Overview',
    heading: 'ligma works wherever you script it',
    intro:
      'ligma is a local daemon (apps/daemon) that owns tasks, goals, projects, ' +
      'runs, and decisions in plain JSON files, plus two thin clients that ' +
      'speak the same HTTP API: this web app and the `ligma` CLI. Anything ' +
      'the web UI can do, a script can do too.',
    bullets: [
      'CLI — `ligma <command>` for shell scripts and quick checks against a running daemon.',
      'HTTP API — http://127.0.0.1:4477/api/* — the same routes the web UI calls, named once in @ligma/api so nothing can drift.',
      'Every route path below is a real entry in packages/api/src/routes.ts.',
    ],
    snippets: [
      {
        label: 'Start the daemon',
        language: 'bash',
        body: 'pnpm --filter @ligma/daemon daemon:start',
      },
      {
        label: 'Confirm it is reachable',
        language: 'bash',
        body: 'curl -sI http://127.0.0.1:4477/api/dashboard',
      },
    ],
    footer:
      'Default port is 4477. Override it with LIGMA_DAEMON_PORT (CLI + daemon) ' +
      "or the CLI's `--port` flag.",
  },
  {
    id: 'cli',
    tabLabel: 'CLI · ligma',
    heading: 'Drive ligma from any shell',
    intro:
      "The `ligma` bin (apps/cli) is a thin client over the daemon's HTTP " +
      'API — every subcommand below is real, there is no hidden surface. Run ' +
      '`ligma --help` for the same list.',
    bullets: [
      '`ligma projects list` — list projects.',
      '`ligma runs list` — list active runs.',
      "`ligma runs tail <runId>` — tail a run's output live (SSE, falls back to polling).",
      '`ligma decisions list` — list decisions.',
      '`ligma decisions answer <id> <option>` — answer a pending decision.',
      '`--port <port>` on any command targets a non-default daemon (or set LIGMA_DAEMON_PORT).',
    ],
    snippets: [
      {
        label: 'List projects and active runs',
        language: 'bash',
        body: 'ligma projects list\nligma runs list',
      },
      {
        label: 'Tail a run live',
        language: 'bash',
        body: 'ligma runs tail run_abc123',
      },
      {
        label: 'List and answer a pending decision',
        language: 'bash',
        body: 'ligma decisions list\nligma decisions answer dec_abc123 "Ship it"',
      },
      {
        label: 'Target a non-default daemon port',
        language: 'bash',
        body: 'ligma --port 5000 projects list\n# or:\nLIGMA_DAEMON_PORT=5000 ligma projects list',
      },
    ],
    footer:
      'From a source checkout, run it via `pnpm --filter @ligma/cli exec ligma <command>` ' +
      'or `node apps/cli/bin/ligma.mjs <command>`.',
  },
  {
    id: 'http',
    tabLabel: 'HTTP API',
    heading: 'Same REST + SSE surface the web UI uses',
    intro:
      'The daemon serves its API at http://127.0.0.1:4477 (override with ' +
      'LIGMA_DAEMON_PORT). Route paths come from packages/api/src/routes.ts, ' +
      'so the web app, the CLI, and your own scripts can never disagree on a URL.',
    bullets: [
      'HEAD /api/dashboard — liveness probe (no body), the same one the web UI polls.',
      'GET /api/daemon — daemon process status (pid, uptime, stats).',
      'GET /api/projects and POST /api/projects — list and create projects.',
      'GET /api/runs — active runs with PID liveness checks applied.',
      "GET /api/runs/:id/output — poll a run's output (JSONL lines + nextOffset cursor).",
      'GET /api/runs/:id/output/stream — the SSE sibling of the route above.',
      'GET /api/decisions and POST /api/decisions — list and create decisions.',
    ],
    snippets: [
      {
        label: 'Check daemon status',
        language: 'bash',
        body: 'curl -s http://127.0.0.1:4477/api/daemon | jq',
      },
      {
        label: 'List projects',
        language: 'bash',
        body: "curl -s http://127.0.0.1:4477/api/projects | jq '.projects'",
      },
      {
        label: 'Create a project',
        language: 'bash',
        body:
          'curl -s -X POST http://127.0.0.1:4477/api/projects \\\n' +
          "  -H 'content-type: application/json' \\\n" +
          "  -d '{\n" +
          '    "name": "Q3 relaunch",\n' +
          '    "description": "Rebuild the marketing site"\n' +
          "  }'",
      },
      {
        label: "Poll a run's output",
        language: 'bash',
        body: "curl -s 'http://127.0.0.1:4477/api/runs/run_abc123/output?offset=0' | jq",
      },
      {
        label: "Stream a run's output (SSE)",
        language: 'bash',
        body:
          "curl -N -H 'accept: text/event-stream' \\\n" +
          "  'http://127.0.0.1:4477/api/runs/run_abc123/output/stream?offset=0'",
      },
      {
        label: 'Create a decision',
        language: 'bash',
        body:
          'curl -s -X POST http://127.0.0.1:4477/api/decisions \\\n' +
          "  -H 'content-type: application/json' \\\n" +
          "  -d '{\n" +
          '    "question": "Ship the v2 pricing page today?",\n' +
          '    "options": ["Ship it", "Hold for review"]\n' +
          "  }'",
      },
    ],
    footer:
      'Request/response types for every route live in @ligma/api — import ' +
      'them for full autocomplete instead of hand-writing shapes.',
  },
  {
    id: 'mcp',
    tabLabel: 'MCP',
    heading: 'A stdio MCP server, for agents that speak MCP',
    intro:
      'apps/daemon/src/mcp-server.ts is a real stdio MCP server (built on ' +
      '@modelcontextprotocol/sdk), not the in-process bridge the Claude ' +
      'subscription provider uses for its own tool-use — that one has no ' +
      'stdio wire and nothing external can attach to it. This one does. Its ' +
      'six tools wrap the exact same route handlers as the HTTP API above, ' +
      'so there is one implementation of every business rule to keep in ' +
      'sync, not two.',
    bullets: [
      'list_projects — List ligma projects, optionally filtered by status (active|paused|completed|archived).',
      'create_project — Create a bare ligma project record (name/description/status/repoPath/tags). This is NOT the prompt-first discovery flow — that stays a UI-only path.',
      'list_tasks — List ligma tasks, optionally filtered by projectId and/or kanban column.',
      'list_decisions — List ligma decisions, optionally filtered by status (pending|answered).',
      'answer_decision — Answer a pending ligma decision by id.',
      'get_run_status — Get the status of one ligma run by id, or every run if no id is given.',
    ],
    snippets: [
      {
        label: 'Run the server (stdio)',
        language: 'bash',
        body: 'pnpm --filter @ligma/daemon mcp:server',
      },
      {
        label: 'Register with Claude Code',
        language: 'bash',
        body: 'claude mcp add ligma -- pnpm --filter @ligma/daemon mcp:server',
      },
    ],
    footer:
      'mcp:server pins LIGMA_DATA_DIR the same way daemon:start does, so it ' +
      'reads and writes the same data/ files as the HTTP API and CLI.',
  },
];

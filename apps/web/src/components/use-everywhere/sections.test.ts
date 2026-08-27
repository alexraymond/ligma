import { API_ROUTES } from '@ligma/api';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DAEMON_URL, GUIDE_SECTIONS } from './sections';

describe('GUIDE_SECTIONS', () => {
  it('ships overview, cli, http, and mcp tabs', () => {
    expect(GUIDE_SECTIONS.map((s) => s.id)).toEqual(['overview', 'cli', 'http', 'mcp']);
  });

  it('documents the real MCP server and names all six of its tools', () => {
    const mcp = GUIDE_SECTIONS.find((s) => s.id === 'mcp');
    expect(mcp).toBeDefined();
    const copy = [mcp?.intro, ...(mcp?.bullets ?? [])].join('\n');
    for (const tool of [
      'list_projects',
      'create_project',
      'list_tasks',
      'list_decisions',
      'answer_decision',
      'get_run_status',
    ]) {
      expect(copy).toContain(tool);
    }
  });

  it('never claims ligma has no MCP server', () => {
    const allCopy = GUIDE_SECTIONS.flatMap((s) => [
      s.heading,
      s.intro,
      ...s.bullets,
      s.footer ?? '',
    ]).join('\n');
    expect(allCopy).not.toContain('no MCP server');
  });

  it('every section renders non-empty heading, intro, and at least one snippet', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.intro.length).toBeGreaterThan(0);
      expect(section.snippets.length).toBeGreaterThan(0);
      for (const snippet of section.snippets) {
        expect(snippet.label.length).toBeGreaterThan(0);
        expect(snippet.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses the real default daemon URL and port', () => {
    expect(DEFAULT_DAEMON_URL).toBe('http://127.0.0.1:4477');
    const allBodies = GUIDE_SECTIONS.flatMap((s) => s.snippets.map((sn) => sn.body)).join('\n');
    expect(allBodies).toContain('4477');
  });

  it("curl snippets only reference routes that exist in @ligma/api's API_ROUTES", () => {
    // Every concrete path referenced across the guide's curl snippets, keyed
    // to the API_ROUTES entry it should match (params substituted with the
    // fixture ids used in the snippet bodies).
    const expectedPaths = [
      API_ROUTES.dashboard,
      API_ROUTES.daemon,
      API_ROUTES.projects,
      API_ROUTES.runOutput.replace(':id', 'run_abc123'),
      API_ROUTES.runOutputStream.replace(':id', 'run_abc123'),
      API_ROUTES.decisions,
    ];

    const allBodies = GUIDE_SECTIONS.flatMap((s) => s.snippets.map((sn) => sn.body)).join('\n');
    for (const path of expectedPaths) {
      expect(allBodies).toContain(path);
    }
  });

  it('CLI snippets only use commands cli.ts actually implements', () => {
    const cliSection = GUIDE_SECTIONS.find((s) => s.id === 'cli');
    expect(cliSection).toBeDefined();
    const allBodies = cliSection!.snippets.map((sn) => sn.body).join('\n');

    const realCommands = [
      'ligma projects list',
      'ligma runs list',
      'ligma runs tail',
      'ligma decisions list',
      'ligma decisions answer',
    ];
    for (const cmd of realCommands) {
      expect(allBodies).toContain(cmd);
    }
  });
});

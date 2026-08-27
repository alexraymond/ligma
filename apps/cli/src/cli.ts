#!/usr/bin/env node
/**
 * `ligma` — the CLI face of the daemon (apps/daemon), speaking the same HTTP
 * API as the web UI via @ligma/api's route constants and types.
 */
import { parseArgs } from 'node:util';
import { CliError, resolveBaseUrl } from './client.js';
import { decisionsAnswer, decisionsList } from './commands/decisions.js';
import { projectsList } from './commands/projects.js';
import { runsList } from './commands/runs.js';
import { tailRun } from './commands/tail.js';

const USAGE = `Usage: ligma <command> [options]

Commands:
  projects list                    List projects
  runs list                        List active runs
  runs tail <runId>                Tail a run's output (live, Ctrl-C to stop)
  decisions list                   List decisions
  decisions answer <id> <option>   Answer a pending decision

Options:
  --port <port>   Daemon port (default: $LIGMA_DAEMON_PORT or 4477)
  -h, --help      Show this help
`;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

const OPTIONS = {
  port: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

async function main(): Promise<void> {
  let parsed: ReturnType<
    typeof parseArgs<{ args: string[]; options: typeof OPTIONS; allowPositionals: true }>
  >;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    process.stderr.write(USAGE);
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length === 0) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const baseUrl = resolveBaseUrl(values.port);
  const [group, action, ...rest] = positionals;
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  try {
    switch (`${group} ${action}`) {
      case 'projects list':
        await projectsList(baseUrl, controller.signal);
        break;
      case 'runs list':
        await runsList(baseUrl, controller.signal);
        break;
      case 'runs tail': {
        const runId = rest[0];
        if (!runId) throw new CliError('Usage: ligma runs tail <runId>');
        await tailRun(baseUrl, runId, controller.signal);
        break;
      }
      case 'decisions list':
        await decisionsList(baseUrl, controller.signal);
        break;
      case 'decisions answer': {
        const [id, ...optionParts] = rest;
        if (!id || optionParts.length === 0)
          throw new CliError('Usage: ligma decisions answer <id> <option>');
        await decisionsAnswer(baseUrl, id, optionParts.join(' '), controller.signal);
        break;
      }
      default:
        process.stderr.write(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    if (controller.signal.aborted && isAbortError(err)) {
      process.exitCode = 130;
      return;
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();

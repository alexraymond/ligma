/**
 * Tool abstraction used by the agent loop.
 *
 * A `Tool` is small on purpose: the orchestration layer only needs the
 * name, the concurrency-safety flag, and a `run()` that honours an
 * AbortSignal. Richer ergonomics (JSON schema parsing, per-param
 * validation, permission gating) live at the pi-ai / provider-SDK layer
 * and do not belong on this seam.
 */

export interface ToolCall {
  /** Provider-issued id (correlates ToolStart / ToolEnd in the event stream). */
  id: string;
  name: string;
  input: unknown;
}

export interface ToolRunContext {
  signal: AbortSignal;
}

export interface ToolRunResult {
  ok: boolean;
  /** Serialized result the model sees next turn. */
  result?: unknown;
  /** Populated when `ok === false`. */
  error?: string;
}

export interface Tool {
  readonly name: string;
  /** Read-only tools run concurrently; anything that mutates state
   *  returns `false` and serializes into its own batch. */
  isConcurrencySafe(input: unknown): boolean;
  run(input: unknown, ctx: ToolRunContext): Promise<ToolRunResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}

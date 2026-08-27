/**
 * The studio's rehearsal seam (`LIGMA_STUB_STUDIO=1`).
 *
 * Every other model wire in a booted instance can be stubbed by pinning a fake
 * `claude` binary through its config, because they all spawn the CLI. The studio
 * does not: it drives the Agent SDK, which speaks its own protocol to that
 * binary. This seam is the one exception, and these tests pin its two rules:
 * it is OFF unless asked, and what it produces announces that it is stubbed.
 */

import type { ProviderStreamItem, ToolRegistry } from '@ligma/core/agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type StudioTurnRequest,
  campaignStubProvider,
  claudeSubscriptionProvider,
  getStudioProvider,
  setStudioProvider,
} from '../src/studio/provider';

const registryWith = (...names: string[]): ToolRegistry =>
  ({
    has: (name: string) => names.includes(name),
    list: () => names.map((name) => ({ name })),
  }) as unknown as ToolRegistry;

const request = (registry: ToolRegistry): StudioTurnRequest => ({
  systemPrompt: '',
  prompt: 'a pricing page',
  registry,
  cwd: '/tmp',
  signal: new AbortController().signal,
  model: 'stub',
});

async function drain(turn: AsyncIterable<ProviderStreamItem>): Promise<ProviderStreamItem[]> {
  const items: ProviderStreamItem[] = [];
  for await (const item of turn) items.push(item);
  return items;
}

afterEach(() => {
  delete process.env.LIGMA_STUB_STUDIO;
  setStudioProvider(null);
});

describe('LIGMA_STUB_STUDIO', () => {
  it('is off by default — the real subscription wire is chosen', () => {
    expect(getStudioProvider()).toBe(claudeSubscriptionProvider);
  });

  it('selects the rehearsal stub only when explicitly set', () => {
    process.env.LIGMA_STUB_STUDIO = '1';
    expect(getStudioProvider()).toBe(campaignStubProvider);
  });

  it('never overrides a provider a test installed', () => {
    process.env.LIGMA_STUB_STUDIO = '1';
    const installed = async (): Promise<never> => {
      throw new Error('not called');
    };
    setStudioProvider(installed);
    expect(getStudioProvider()).toBe(installed);
  });
});

describe('what the stub produces', () => {
  it("writes files through the registry's own tools, and says it was stubbed", async () => {
    const items = await drain(await campaignStubProvider(request(registryWith('write_file'))));
    const batch = items.find((i) => i.type === 'tool_call_batch');
    expect(batch).toBeTruthy();
    const calls = (batch as { calls: { name: string; input: { path: string; content: string } }[] })
      .calls;
    expect(calls.map((c) => c.name)).toEqual(['write_file', 'write_file']);
    expect(calls[0]?.input.content).toContain('LIGMA_STUB_STUDIO');
    expect(items.at(-1)).toEqual({ type: 'done', stopReason: 'stop' });
  });

  it('answers the critique lane and the plan lane in their own shapes', async () => {
    const critique = await drain(
      await campaignStubProvider(request(registryWith('submit_critique'))),
    );
    const critiqueCall = (
      critique.find((i) => i.type === 'tool_call_batch') as { calls: { name: string }[] }
    ).calls[0]!;
    expect(critiqueCall.name).toBe('submit_critique');

    const plan = await drain(await campaignStubProvider(request(registryWith('submit_plan'))));
    const planCall = (
      plan.find((i) => i.type === 'tool_call_batch') as { calls: { name: string }[] }
    ).calls[0]!;
    expect(planCall.name).toBe('submit_plan');
  });
});

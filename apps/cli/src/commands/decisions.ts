import { type DecisionItem, apiPath } from '@ligma/api';
import { CliError, daemonJson } from '../client.js';
import { printTable, truncate } from '../format.js';

export async function decisionsList(baseUrl: string, signal?: AbortSignal): Promise<void> {
  const res = await daemonJson<{ decisions: DecisionItem[] }>(baseUrl, apiPath('decisions'), {
    signal,
  });

  if (res.decisions.length === 0) {
    console.log('No decisions.');
    return;
  }

  const rows = res.decisions.map((d) => [d.id, d.status, truncate(d.question, 70)]);
  printTable(['ID', 'STATUS', 'QUESTION'], rows);
}

/**
 * Answers a decision through the same `PATCH /api/decisions` disposition the
 * deck UI's swipe/click actions use (apps/web/src/components/decision-deck.tsx)
 * — body shape `{ id, action: "answer", answer }`, not the create-decision POST.
 */
export async function decisionsAnswer(
  baseUrl: string,
  id: string,
  answer: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!answer.trim()) throw new CliError('Usage: ligma decisions answer <id> <option>');

  const res = await daemonJson<{ decision: DecisionItem }>(baseUrl, apiPath('decisions'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'answer', answer }),
    signal,
  });

  console.log(`Answered ${res.decision.id}: "${res.decision.answer}"`);
}

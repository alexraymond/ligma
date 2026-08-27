/**
 * D7 OD-033/OD-036. Discovery forms rendered four of open-design's sixteen
 * control types, then six (the common set), and now thirteen — the six plus
 * seven low-cost native inputs ported from the reference (range, date, time,
 * url, email, tel, switch). The daemon's contract is what decides which ones a
 * model may ask for: an unlisted type is a parse failure, not a
 * silently-degraded control.
 */

import { describe, expect, it } from 'vitest';
import { discoveryReplySchema } from '../src/engine/discovery';

function reply(type: string, options: string[] = []) {
  return {
    needMore: true,
    form: {
      title: 'Questions',
      description: '',
      questions: [{ id: 'q1', label: 'How many?', type, options, required: true, help: '' }],
    },
  };
}

describe('discovery question controls', () => {
  it('accepts the thirteen supported control types', () => {
    for (const type of [
      'single',
      'multi',
      'select',
      'text',
      'textarea',
      'number',
      'range',
      'date',
      'time',
      'url',
      'email',
      'tel',
      'switch',
    ]) {
      const parsed = discoveryReplySchema.safeParse(reply(type, ['a', 'b']));
      expect([type, parsed.success]).toEqual([type, true]);
    }
  });

  it('rejects a type nothing renders, rather than shipping a dead field', () => {
    for (const type of ['color', 'file', 'direction-cards', 'datetime-local']) {
      expect(discoveryReplySchema.safeParse(reply(type)).success).toBe(false);
    }
  });

  it('lets the prose, number and low-cost native types omit options', () => {
    for (const type of [
      'text',
      'textarea',
      'number',
      'range',
      'date',
      'time',
      'url',
      'email',
      'tel',
      'switch',
    ]) {
      const parsed = discoveryReplySchema.safeParse(reply(type));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.form?.questions[0].options).toEqual([]);
    }
  });
});

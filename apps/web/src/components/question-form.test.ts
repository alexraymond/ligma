import type { DiscoveryForm } from '@ligma/api';
/**
 * D7 OD-033/OD-036. The web side of the low-cost input port: each new native
 * control type renders the matching `<input type>` (or, for `switch`, the
 * shadcn `Switch`'s `role="switch"`), and the Back/Skip affordances only
 * appear where they make sense (Back needs a `previous` turn; Skip only makes
 * sense for an optional field that can genuinely be left blank).
 *
 * No jsdom/@testing-library in this app (see vitest.config.ts — `environment:
 * "node"`), so this renders with `react-dom/server`'s `renderToStaticMarkup`
 * instead of adding a new test-rendering dependency for a handful of
 * assertions on the output markup — the zod acceptance side of this port is
 * covered by apps/daemon/__tests__/discovery-controls.test.ts.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionFormCard } from './question-form';

const form: DiscoveryForm = {
  id: 'frm_1',
  title: 'A few questions',
  description: '',
  questions: [
    { id: 'launch', label: 'Launch date', type: 'date', options: [], required: false, help: '' },
    { id: 'checkin', label: 'Check-in time', type: 'time', options: [], required: false, help: '' },
    { id: 'site', label: 'Site', type: 'url', options: [], required: false, help: '' },
    { id: 'contact', label: 'Contact email', type: 'email', options: [], required: true, help: '' },
    { id: 'phone', label: 'Phone', type: 'tel', options: [], required: false, help: '' },
    { id: 'budget', label: 'Budget', type: 'range', options: [], required: false, help: '' },
    { id: 'sync', label: 'Real-time sync?', type: 'switch', options: [], required: true, help: '' },
  ],
};

function markup(previous?: { form: DiscoveryForm; answers: Record<string, string | string[]> }) {
  return renderToStaticMarkup(
    createElement(QuestionFormCard, { form, busy: false, onSubmit: () => {}, previous }),
  );
}

describe('QuestionFormCard — ported native input types', () => {
  it('renders the platform input for date, time, url, email and tel', () => {
    const html = markup();
    for (const type of ['date', 'time', 'url', 'email', 'tel']) {
      expect(html).toContain(`type="${type}"`);
    }
  });

  it('renders a range slider', () => {
    expect(markup()).toContain('type="range"');
  });

  it('renders the shadcn Switch as a native switch role', () => {
    expect(markup()).toContain('role="switch"');
  });

  it("seeds switch and range so a required one isn't stuck 'missing'", () => {
    // A required switch defaults to unchecked, which must count as answered —
    // if it didn't, disabled-submit gating would deadlock on a field the user
    // never has to touch. Reflected here as aria-checked="false", not absent.
    expect(markup()).toContain('aria-checked="false"');
  });
});

describe('QuestionFormCard — Back and Skip', () => {
  it('has no Back control without a previous turn', () => {
    expect(markup()).not.toContain('Back — review previous answers');
  });

  it("shows Back — review only, per the answers route's contract — when a previous turn is given", () => {
    const html = markup({ form: { ...form, id: 'frm_0' }, answers: { contact: 'a@b.com' } });
    expect(html).toContain('Back — review previous answers');
  });

  it('offers Skip only for optional fields that can be meaningfully cleared', () => {
    const html = markup();
    // 4 optional, clearable fields: launch, checkin, site, phone.
    // Excluded: contact/sync (required) and budget (a range always has a value).
    expect(html.match(/>Skip</g)?.length ?? 0).toBe(4);
  });
});

describe('QuestionFormCard — Still needed header and You decide (build brief §16 Phase 2)', () => {
  it('names how much of the form is still required, before anything is filled in', () => {
    // Two required questions (contact, sync); sync is a switch, seeded to a
    // real value ("false") the moment the form opens, so only contact is
    // still outstanding: 1 of 2.
    expect(markup()).toContain('Still needed: 1 of 2');
  });

  it('offers You decide beside Skip for every non-switch, non-range question, including required ones', () => {
    // launch, checkin, site, contact, phone: 5. Excluded: budget (range) and sync (switch).
    expect(markup().match(/>You decide</g)?.length ?? 0).toBe(5);
  });
});

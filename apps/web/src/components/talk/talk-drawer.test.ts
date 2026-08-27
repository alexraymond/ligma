/**
 * `?talk=1` deep-link (W15): the palette's "Talk — <project>" command used to
 * just navigate to the project, landing on the page with no drawer open and a
 * second ⌘J still required. No jsdom in this vitest config (component needs a
 * Next.js router context to render), so this pins the source facts a render
 * would otherwise verify — same convention as `task-detail-panel.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.resolve(__dirname, './talk-drawer.tsx'), 'utf-8');

describe('TalkLauncher — ?talk=1 deep link', () => {
  it('opens the drawer when the query param is present on arrival', () => {
    const start = SOURCE.indexOf('export function TalkLauncher');
    const body = SOURCE.slice(start);
    expect(body).toContain("if (searchParams.get('talk') !== '1') return;");
    expect(body).toContain('setOpen(true);');
  });

  it('strips the param afterward so a refresh does not re-open it', () => {
    const start = SOURCE.indexOf('export function TalkLauncher');
    const body = SOURCE.slice(start);
    expect(body).toContain("next.delete('talk');");
    expect(body).toContain('router.replace(');
  });
});

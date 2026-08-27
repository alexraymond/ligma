/**
 * browser-bridge.ts — the browser transport of the persona bridge.
 *
 * One Chromium browser per verification run, driven through the shared control
 * server in `bridge-server.ts` (which owns the loopback/Host/token rules and the
 * step ledger). Personas get `Bash` and nothing else, so they drive the browser
 * with curl; every mutating call is recorded server-side into steps.jsonl with an
 * auto-screenshot on click/goto. That means the evidence exists even if the
 * persona lies about what it did.
 *
 * The rule that is specific to THIS transport: /goto refuses any origin but the
 * env's product origin (403). A persona cannot wander onto the open internet or
 * onto another env's port.
 *
 * ponytail: one BrowserContext PER PERSONA (not one for the whole run, as the
 * brief's sketch said). Personas run concurrently and `setOffline`, viewport and
 * tab indices are context-scoped — sharing one context would let the Saboteur's
 * offline switch break the naive user's session and make the evidence a lie.
 * One browser process is still shared, which is where the cost actually is.
 */

import path from 'node:path';
import { type Browser, type BrowserContext, type Page, chromium } from '@playwright/test';
import {
  ACTION_TIMEOUT_MS,
  type Bridge,
  type BridgeHandler,
  type BridgeSession,
  type BridgeStep,
  SessionRecorder,
  type StepEvidence,
  serveBridge,
  str,
} from './bridge-server';

export type { Bridge, BridgeSession, BridgeStep };

const SNAPSHOT_LIMIT = 8_000;
const CONSOLE_BUFFER = 200;

export interface BridgeOptions {
  /** The env's product origin. The ONLY origin /goto will navigate to. */
  origin: string;
  /** Verification run root: <data>/verification-runs/<runId>. */
  runDir: string;
  headless?: boolean;
}

interface ConsoleEntry {
  type: string;
  text: string;
  at: string;
}

interface NetworkEntry {
  url: string;
  failure: string;
  at: string;
}

class Session extends SessionRecorder {
  private readonly shotsDir: string;
  private shotIndex = 0;
  private pages: Page[] = [];
  private active = 0;
  readonly consoleLog: ConsoleEntry[] = [];
  readonly network: NetworkEntry[] = [];

  constructor(
    name: string,
    private readonly context: BrowserContext,
    runDir: string,
  ) {
    super(name, runDir);
    this.shotsDir = this.subdir('shots');
  }

  async page(): Promise<Page> {
    if (this.pages.length === 0) {
      this.pages.push(await this.newPage());
      this.active = 0;
    }
    return this.pages[this.active];
  }

  async newPage(): Promise<Page> {
    const page = await this.context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.on('console', (msg) =>
      this.pushConsole({ type: msg.type(), text: msg.text(), at: new Date().toISOString() }),
    );
    page.on('pageerror', (err) =>
      this.pushConsole({ type: 'pageerror', text: err.message, at: new Date().toISOString() }),
    );
    page.on('requestfailed', (req) => {
      if (this.network.length < CONSOLE_BUFFER) {
        this.network.push({
          url: req.url(),
          failure: req.failure()?.errorText ?? 'unknown',
          at: new Date().toISOString(),
        });
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && this.network.length < CONSOLE_BUFFER) {
        this.network.push({
          url: res.url(),
          failure: `HTTP ${res.status()}`,
          at: new Date().toISOString(),
        });
      }
    });
    return page;
  }

  private pushConsole(entry: ConsoleEntry): void {
    if (this.consoleLog.length < CONSOLE_BUFFER) this.consoleLog.push(entry);
  }

  async addTab(): Promise<number> {
    this.pages.push(await this.newPage());
    this.active = this.pages.length - 1;
    return this.active;
  }

  switchTab(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.pages.length) {
      throw new Error(`No tab ${index} (open tabs: ${this.pages.length})`);
    }
    this.active = index;
  }

  tabCount(): number {
    return this.pages.length;
  }

  setOffline(on: boolean): Promise<void> {
    return this.context.setOffline(on);
  }

  /** Save a PNG into this persona's shots dir. Returns the run-relative path. */
  async screenshot(label: string): Promise<string> {
    const page = await this.page();
    this.shotIndex += 1;
    const safe = label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'shot';
    const file = `${String(this.shotIndex).padStart(2, '0')}-${safe}.png`;
    await page.screenshot({ path: path.join(this.shotsDir, file) });
    return this.rel('shots', file);
  }
}

/** Mutating actions get a step; reads do not. Click/goto also get a screenshot. */
const MUTATING = new Set([
  'goto',
  'click',
  'fill',
  'press',
  'back',
  'reload',
  'viewport',
  'newtab',
  'switchtab',
  'offline',
]);
const AUTO_SHOT = new Set(['goto', 'click']);

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const origin = new URL(opts.origin).origin;
  const browser: Browser = await chromium.launch({ headless: opts.headless !== false });

  /** Resolve a persona-supplied URL, refusing anything off the product origin. */
  const resolveUrl = (raw: string): string => {
    const target = new URL(raw, `${origin}/`);
    if (target.origin !== origin) {
      throw Object.assign(
        new Error(`Refusing to navigate to ${target.origin}: the product under test is ${origin}`),
        {
          statusCode: 403,
        },
      );
    }
    return target.toString();
  };

  const handler: BridgeHandler<Session> = {
    mutating: MUTATING,

    async newSession(name) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      return new Session(name, context, opts.runDir);
    },

    async stepEvidence(session, action, failed): Promise<StepEvidence> {
      // Auto-evidence: a shot even on failure, showing what the persona saw.
      const screenshot = AUTO_SHOT.has(action)
        ? await session.screenshot(`${action}${failed ? '-failed' : ''}`).catch(() => null)
        : null;
      let url = '';
      try {
        url = (await session.page()).url();
      } catch {
        url = '';
      }
      return { screenshot, url };
    },

    async close() {
      await browser.close();
    },

    async perform(session, action, body) {
      const page = await session.page();

      switch (action) {
        case 'goto': {
          const url = str(body.url);
          if (!url) throw new Error('goto needs { url }');
          await page.goto(resolveUrl(url), { waitUntil: 'domcontentloaded' });
          return { url: page.url() };
        }
        case 'click': {
          const selector = str(body.selector);
          const text = str(body.text);
          if (!selector && !text) throw new Error('click needs { selector } or { text }');
          if (selector) await page.locator(selector).first().click({ timeout: ACTION_TIMEOUT_MS });
          else
            await page
              .getByText(text!, { exact: false })
              .first()
              .click({ timeout: ACTION_TIMEOUT_MS });
          return { clicked: selector ?? `text:${text}`, url: page.url() };
        }
        case 'fill': {
          const selector = str(body.selector);
          const value = typeof body.value === 'string' ? body.value : null;
          if (!selector || value === null) throw new Error('fill needs { selector, value }');
          await page.locator(selector).first().fill(value, { timeout: ACTION_TIMEOUT_MS });
          return { filled: selector, length: value.length };
        }
        case 'press': {
          const key = str(body.key);
          if (!key) throw new Error('press needs { key }');
          await page.keyboard.press(key);
          return { pressed: key };
        }
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded' });
          return { url: page.url() };
        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded' });
          return { url: page.url() };
        case 'viewport': {
          const w = Number(body.w);
          const h = Number(body.h);
          if (
            !Number.isFinite(w) ||
            !Number.isFinite(h) ||
            w < 200 ||
            h < 200 ||
            w > 4000 ||
            h > 4000
          ) {
            throw new Error('viewport needs { w, h } between 200 and 4000');
          }
          await page.setViewportSize({ width: Math.round(w), height: Math.round(h) });
          return { w: Math.round(w), h: Math.round(h) };
        }
        case 'newtab': {
          const index = await session.addTab();
          return { index, tabs: session.tabCount() };
        }
        case 'switchtab': {
          session.switchTab(Number(body.index));
          return { index: Number(body.index), url: (await session.page()).url() };
        }
        case 'offline': {
          const on = body.on !== false;
          await session.setOffline(on);
          return { offline: on };
        }
        case 'snapshot': {
          const aria = await page
            .locator('body')
            .ariaSnapshot()
            .catch(() => '(aria snapshot unavailable)');
          const text = await page
            .locator('body')
            .innerText()
            .catch(() => '');
          const half = Math.floor(SNAPSHOT_LIMIT / 2);
          return {
            url: page.url(),
            title: await page.title().catch(() => ''),
            aria: aria.slice(0, half),
            text: text.replace(/\n{3,}/g, '\n\n').slice(0, SNAPSHOT_LIMIT - half),
            truncated: aria.length > half || text.length > SNAPSHOT_LIMIT - half,
          };
        }
        case 'screenshot': {
          const shot = await session.screenshot(str(body.label) ?? 'requested');
          return { screenshot: shot };
        }
        case 'console':
          return { entries: session.consoleLog };
        case 'network':
          return { failures: session.network };
        default:
          throw Object.assign(new Error(`Unknown action "${action}"`), { statusCode: 404 });
      }
    },
  };

  return serveBridge(handler);
}

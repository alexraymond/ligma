/**
 * drill-support.ts — the bits every drill (d1, d2, d4, ...) needs identically:
 * a fetch wrapper that never throws on a non-2xx body, and a step-runner that
 * records PASS/FAIL/SKIP and stops a drill dead at its first FAIL.
 *
 * Pulled out of drill.ts once a second and third drill needed the same
 * machinery — one copy, not three copies drifting.
 */

export type Outcome = "PASS" | "FAIL" | "SKIP";
export interface StepResult {
  name: string;
  outcome: Outcome;
  detail: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A thin fetch wrapper: never throws on a non-2xx, so a route's own error body is visible. */
export async function call(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — leave it as the raw text so a failure message can show it.
  }
  return { status: res.status, body };
}

/**
 * One drill's step log: `step()` runs a named check, records its outcome, and
 * — once anything has FAILed — SKIPs everything after it rather than running a
 * step against state a prior failure left undefined.
 */
export function createStepRunner(logPrefix: string): {
  results: StepResult[];
  step: (name: string, fn: () => Promise<string>) => Promise<void>;
  fail: (name: string, detail: string) => void;
} {
  const results: StepResult[] = [];
  let aborted = false;

  const step = async (name: string, fn: () => Promise<string>): Promise<void> => {
    if (aborted) {
      results.push({ name, outcome: "SKIP", detail: "skipped — an earlier step failed" });
      console.log(`${logPrefix}[SKIP] ${name}`);
      return;
    }
    try {
      const detail = await fn();
      results.push({ name, outcome: "PASS", detail });
      console.log(`${logPrefix}[PASS] ${name} — ${detail}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ name, outcome: "FAIL", detail });
      console.log(`${logPrefix}[FAIL] ${name} — ${detail}`);
      aborted = true;
    }
  };

  // For a failure outside any named step (boot itself blowing up).
  const fail = (name: string, detail: string): void => {
    results.push({ name, outcome: "FAIL", detail });
    aborted = true;
  };

  return { results, step, fail };
}

export function printSummary(title: string, results: StepResult[]): boolean {
  console.log(`\n=== ${title} SUMMARY — not acceptance evidence ===`);
  for (const r of results) {
    console.log(`[${r.outcome}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const failed = results.some((r) => r.outcome === "FAIL");
  console.log(failed ? `\n${title} FAILED — not acceptance evidence either way.` : `\n${title} PASSED — not acceptance evidence.`);
  return failed;
}

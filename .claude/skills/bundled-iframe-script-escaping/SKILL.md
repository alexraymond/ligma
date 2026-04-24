---
name: bundled-iframe-script-escaping
description: Avoid the double-escape trap when embedding JavaScript source inside a TypeScript template-literal string that will later be injected and executed inside an iframe. Applies to overlay/sandbox/runtime packages that ship string-built scripts. Trigger words — "OVERLAY_SCRIPT", "wrapJsxAsSrcdoc", "srcdoc injection", "iframe postMessage", "SyntaxError: Invalid or unexpected token", "Invalid regular expression" in a bundled iframe script.
allowed-tools: Read, Edit, Bash
---

# Escape layering for bundled iframe scripts

## The pipeline

Ligma builds `OVERLAY_SCRIPT` (a `string`) inside a backtick template literal
in `packages/runtime/src/overlay.ts`. That string is later interpolated into
an iframe's srcdoc via `<script>${OVERLAY_SCRIPT}</script>` in `index.ts`.
Tests evaluate it through the identical path the iframe uses.

There are **two parsers in series**:

1. **TypeScript template-literal parser** (build time) — consumes the backticks.
2. **JavaScript parser inside the iframe** (runtime) — consumes the resulting string as source code.

Every `\\` in the template literal collapses to `\` in the produced string.
Then every `\\` inside string literals at the iframe layer collapses again.

## The trap

```ts
// overlay.ts — INSIDE backticks:
function escape(v) { return v.replace(/\\/g, '\\\\'); }
```

- Template parse: `\\` → `\`. Resulting script text: `return v.replace(/\/g, '\\');`
- Iframe JS parse: `/\/g` is **an unterminated regex** (`\` escapes the slash), so the whole script throws `SyntaxError: Invalid or unexpected token`.

To get a regex that matches a single backslash at runtime inside the iframe
(`/\\/g`), you need **four** backslashes in the overlay.ts source: `/\\\\/g`.
And for a replacement string `'\\\\'` (two chars in the iframe, which JS then
interprets as one literal backslash), you need **eight** backslashes in the
overlay source.

This layering is an actual bug I burned time on: the tests failed with
`SyntaxError: Invalid or unexpected token` and the stack pointed at the
sandbox factory with no hint as to which bit of OVERLAY_SCRIPT was broken.

## The fix — avoid string-escape arithmetic entirely

Don't build CSS selectors by concatenating user-controlled attribute values.
Mutate the DOM directly and read attributes there, where there's no escaping
problem at all:

```js
// ✅ Pattern that works — runs inside the iframe after OVERLAY_SCRIPT injects.
function applyArtboardOffsets() {
  var nodes;
  try { nodes = document.querySelectorAll('[data-artboard]'); }
  catch (_) { return; }
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var label = node.getAttribute('data-label') || '';   // ← raw value, any chars OK
    var off = artboardOffsetsByLabel[label];
    try {
      if (off) {
        node.style.transform = 'translate3d(' + off.x + 'px,' + off.y + 'px,0)';
        node.style.zIndex = String(off.z || 1);
      } else {
        node.style.transform = '';
        node.style.zIndex = '';
      }
    } catch (_) { /* inline style denied — skip */ }
  }
}
```

Alternatives when you *must* build a string that contains backslashes or
quotes at the iframe layer:

- `JSON.stringify(value)` — handles all the quoting for you; one layer of
  escape instead of three.
- `.split(char).join(replacement)` instead of `.replace(regex, replacement)` —
  no regex literal, no backslash-in-a-regex-in-a-string-in-a-template issue.
- If the value is always a short ASCII identifier (no spaces, no unicode,
  no quotes), assign a synthetic `data-cs-id="…"` attribute in a first pass
  and build selectors against *that* instead of the user-facing label.

## How to diagnose the double-escape bug

```bash
# Import the script string and attempt to parse it.
pnpm --filter @ligma/runtime test
```

The runtime test harness constructs the same parser path the iframe takes,
so **if the runtime test suite fails with `SyntaxError: Invalid or unexpected
token`, the culprit is almost certainly an escape-layering bug in a recent
edit to `overlay.ts`.**

To narrow down *which* function inside OVERLAY_SCRIPT is the offender, add a
temporary `console.log(OVERLAY_SCRIPT.slice(index - 20, index + 200))` at
the top of a failing test and binary-search.

## Counting the install list

When you add new event listeners to the reattach-loop (`installs` array in
`overlay.ts`), the throttle tests in `overlay.test.ts` hard-code bounds
tied to the list length:

```ts
// Upper bound = 2 × installs.length (remove + add per spec).
expect(warn.mock.calls.length).toBeLessThanOrEqual(14);
// Upper bound = installs.length.
expect(warn.mock.calls.length).toBeLessThanOrEqual(7);
```

If you add `pointerdown`/`pointermove`/`pointerup` (3 new entries), update
both numbers — or the tests will fail with a confusing "expected 14 to be
less than or equal to 8" mid-refactor.

## Skip CANVAS_SIZE broadcasts when body isn't rendered

If you post `CANVAS_SIZE` on script load, run the test harness, and get
extra messages in `postedToParent`, guard the post:

```js
if (w === 0 && h === 0) return;  // not rendered yet — skip
```

The harness uses `fakeDocument = { body: {} }` with no `documentElement`,
so `scrollWidth`/`scrollHeight` are `undefined`. Fall through to 0 and
bail — don't post `{ width: NaN, height: NaN }`.

/**
 * `POST /api/design-systems/wizard/create-from-tokens` — OD-010.
 *
 * The Library could browse 151 vendored design systems and create none. This
 * writes one: a name, a token set, and out comes a package in the vendored
 * layout that `GET /api/design-systems` serves as an overlay over the
 * vendored catalog.
 *
 * It writes to `<DATA_DIR>/design-systems/<id>`, never into the checkout
 * (docs/DECISIONS.md 2026-08-13): a design system somebody authored is their
 * data, and the vendored directory is repo content the wizard only ever reads.
 *
 * The whole route is the three refusals plus a write:
 *
 *   400 — the id is not a bare safe slug, or the tokens are not a token set.
 *   409 — a vendored package already owns that id. Always. No flag overrides it.
 *   409 — the authored store already holds that id and `overwrite` was not set.
 *
 * Revisions: the vendored package format carries no version field, so there is
 * nothing to bump. Editing an authored system therefore means re-submitting it
 * with `overwrite: true`, which replaces the files in place and keeps no
 * previous revision. Real versioning is v2 — see DESIGN.md §4 in every package
 * the wizard writes, which says exactly this to the person holding it.
 */

import { z } from "zod";
import { NextResponse } from "../../../../http";
import { validateBody } from "../../../../store/validations";
import { authoredDesignSystemsRoot, designSystemsRoot } from "../../route";
import {
  isValidSystemId,
  occupantOf,
  slugify,
  validateTokens,
  writePackage,
  type WizardTokens,
} from "../_lib";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  /** Optional explicit slug; derived from `name` when absent. */
  id: z.string().min(1).max(48).optional(),
  category: z.string().min(1).max(80).optional(),
  blurb: z.string().min(1).max(400).optional(),
  /** Where the tokens were proposed from, when the wizard started at a URL. */
  sourceUrl: z.string().url().max(2000).optional(),
  /** Replace an existing *authored* package. Never touches a vendored one. */
  overwrite: z.boolean().optional(),
  tokens: z.record(z.string(), z.string()),
});

export async function POST(request: Request): Promise<Response> {
  const validation = await validateBody(request, createSchema);
  if (!validation.success) return validation.error;
  const body = validation.data;

  const id = body.id ?? slugify(body.name);
  if (!isValidSystemId(id)) {
    return NextResponse.json(
      { error: `"${id}" is not a usable design-system id — use lowercase letters, digits and dashes` },
      { status: 400 },
    );
  }

  const tokenCheck = validateTokens(body.tokens);
  if (!tokenCheck.ok) {
    return NextResponse.json({ error: "Invalid token set", details: tokenCheck.errors }, { status: 400 });
  }

  // Two roots, checked in order: nothing the repo vendors may be taken, and
  // only then may the author's own store be written. Keeping the refusal on
  // the vendored root is what makes the catalog's overlay disjoint.
  if ((await occupantOf(designSystemsRoot(), id)).kind !== "free") {
    return NextResponse.json(
      { error: `"${id}" is a vendored design system and is never overwritten — choose another name`, id },
      { status: 409 },
    );
  }
  const root = authoredDesignSystemsRoot();
  const occupant = await occupantOf(root, id);
  if (occupant.kind !== "free" && body.overwrite !== true) {
    return NextResponse.json(
      {
        error: `You already have a design system called "${id}". Re-creating it replaces its files; there is no version history.`,
        id,
        overwritable: true,
      },
      { status: 409 },
    );
  }

  const files = await writePackage(root, {
    id,
    name: body.name,
    category: body.category ?? "User-created",
    blurb: body.blurb ?? `${body.name}, created in the design-system wizard.`,
    tokens: body.tokens as WizardTokens,
    ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
  });

  return NextResponse.json(
    { id, name: body.name, files, replaced: occupant.kind !== "free" },
    { status: 201 },
  );
}

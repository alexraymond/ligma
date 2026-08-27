/**
 * zod schemas for the Library's use-tracking and bookmark endpoints
 * (OD-156/157). `id` is a catalog entry id (a vendored directory name, or a
 * user-authored skill id) — free text up to a title-length cap, not a path:
 * these routes only ever use it as a store key, never to touch the filesystem.
 */
import { z } from 'zod';

const kindEnum = z.enum(['design-system', 'skill', 'craft']);

export const libraryMetaUseSchema = z.object({
  kind: kindEnum,
  id: z.string().min(1).max(200),
});

export const libraryMetaBookmarkSchema = z.object({
  kind: kindEnum,
  id: z.string().min(1).max(200),
  saved: z.boolean(),
});

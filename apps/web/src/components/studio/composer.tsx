'use client';

/**
 * The Studio composer's two attachments to the prompt box: reference images
 * ("make it look like this") and `@`-mentions of the vendored skill catalog.
 *
 * Both are deliberately thin. The image reader and its size gate are
 * `workspace/file-upload.ts`'s, already used by References and Design Files;
 * the catalog fetch is `library/catalog.ts`'s, already used by the Library; the
 * filter is the same `filterEntries` the design-system picker uses. What is new
 * here is the caret arithmetic — which is pure, and therefore tested
 * (`composer.test.ts`) rather than eyeballed.
 *
 * The mention list is a plain block above the textarea rather than a Radix
 * popover: a popover takes focus, and taking focus away from a caret
 * mid-word is exactly what a type-ahead must not do.
 */

import { fetchSkillCatalog, filterEntries } from '@/components/library/catalog';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import {
  MAX_IMAGE_BYTES,
  formatBytes,
  readFileAsDataUrl,
  validateFileSize,
} from '@/components/workspace/file-upload';
import type { SkillCatalogEntry } from '@ligma/api';
import { Paperclip, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/** An image the composer is holding — not uploaded until the turn is sent. */
export interface PendingAttachment {
  name: string;
  /** `data:image/png;base64,…` — also what the thumbnail renders. */
  dataUrl: string;
  size: number;
}

// ─── Mention arithmetic (pure) ───────────────────────────────────────────────

/** Skill ids are directory names; the mention accepts the same characters. */
const MENTION_BODY = /^[A-Za-z0-9_-]*$/;

/**
 * The `@`-mention the caret is currently inside, or null.
 *
 * A mention only opens at a word boundary, so `alex@tyrell.global` never opens
 * the list, and it closes as soon as the token stops looking like an id — a
 * space, a newline, punctuation.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const at = text.lastIndexOf('@', Math.max(caret - 1, 0));
  if (at < 0 || at >= caret) return null;
  const before = at === 0 ? '' : text[at - 1];
  if (before !== '' && !/[\s(]/.test(before)) return null;
  const query = text.slice(at + 1, caret);
  return MENTION_BODY.test(query) ? { start: at, query } : null;
}

/** Replace the in-progress mention with the chosen id, caret after it. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  id: string,
): { text: string; caret: number } {
  const head = `${text.slice(0, start)}@${id} `;
  return { text: `${head}${text.slice(caret)}`, caret: head.length };
}

// ─── The catalog ─────────────────────────────────────────────────────────────

/**
 * One fetch per page load, shared by every composer.
 *
 * ponytail: a module-level promise, not a cache library — the catalog is a
 * read-only directory listing that cannot change while the tab is open.
 */
let catalogPromise: Promise<SkillCatalogEntry[]> | null = null;

export function useSkillCatalog(): SkillCatalogEntry[] {
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([]);
  useEffect(() => {
    let live = true;
    catalogPromise ??= fetchSkillCatalog();
    catalogPromise
      .then((next) => {
        if (live) setSkills(next);
      })
      .catch(() => {
        // A catalog that will not load makes `@` inert, which is exactly what
        // an unrecognised mention already is. Nothing to interrupt the user for.
        catalogPromise = null;
      });
    return () => {
      live = false;
    };
  }, []);
  return skills;
}

/** The type-ahead. Renders nothing when the query matches nothing. */
export function SkillMentionList({
  query,
  onPick,
}: { query: string; onPick: (id: string) => void }) {
  const skills = useSkillCatalog();
  const matches = useMemo(
    () =>
      filterEntries(
        skills.map((skill) => ({
          id: skill.id,
          label: skill.id,
          meta: skill.title,
          blurb: skill.description,
        })),
        query,
      ).slice(0, 8),
    [skills, query],
  );

  if (matches.length === 0) return null;
  return (
    <div
      className="max-h-52 overflow-y-auto rounded border bg-popover p-1 shadow-sm"
      role="listbox"
      aria-label="Skills"
    >
      {matches.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={false}
          // `onMouseDown` rather than `onClick`: the click would blur the
          // textarea first and the caret we are about to write into is gone.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(entry.id);
          }}
          className="flex w-full items-baseline gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent"
        >
          <span className="shrink-0 font-mono">@{entry.id}</span>
          {/* Most packages name themselves after their directory, so showing
              the title beside the id would print it twice. */}
          <span className="truncate text-[10px] text-muted-foreground">
            {entry.meta && entry.meta !== entry.id ? entry.meta : entry.blurb}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * Read dropped/pasted/chosen files into pending attachments.
 *
 * Non-images are ignored rather than refused — a paste carries whatever the
 * clipboard had — but an image that is too big says so, using the same cap the
 * daemon enforces.
 */
export async function readAttachments(
  files: readonly File[],
  onError: (message: string) => void,
): Promise<PendingAttachment[]> {
  const out: PendingAttachment[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const tooBig = validateFileSize(file, MAX_IMAGE_BYTES);
    if (tooBig) {
      onError(`${file.name || 'image'}: ${tooBig}`);
      continue;
    }
    out.push({
      name: file.name || 'pasted image',
      dataUrl: await readFileAsDataUrl(file),
      size: file.size,
    });
  }
  return out;
}

export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <li key={`${item.name}-${index}`} className="relative">
          {/* Local data URL, never a remote fetch — next/image would add a
              loader for a picture that is already in memory. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.dataUrl}
            alt={item.name}
            title={`${item.name} · ${formatBytes(item.size)}`}
            className="h-12 w-12 rounded border object-cover"
          />
          <button
            type="button"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(index)}
            className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 shadow-sm hover:bg-accent"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The paperclip. A file input, because the platform already has one. */
export function AttachButton({
  onFiles,
  disabled,
}: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  return (
    <Tip content="Attach a reference image">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Attach a reference image"
        disabled={disabled}
        asChild
      >
        <label>
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              onFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
        </label>
      </Button>
    </Tip>
  );
}

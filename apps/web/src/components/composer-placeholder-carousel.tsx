'use client';

import { nextPlaceholderIndex, placeholdersForKind } from '@/lib/composer';
import { useEffect, useState } from 'react';

// Slow and plain — OD-087 asks for a calm rotation, no autoplaying flash.
// This is a productivity tool, not a landing page: no typewriter, no easing,
// just a text swap every few seconds. (Compare the reference's
// PlaceholderCarousel, which types each character in — deliberately not
// ported: that's the landing-page flourish this composer is asked to skip.)
const ROTATE_MS = 6000;

/**
 * Rotates the composer's placeholder text through a calm cycle while the box
 * is empty. Pass `active={false}` once there's real input to show instead —
 * the native placeholder is hidden then anyway, so this also stops the timer
 * rather than ticking uselessly in the background.
 */
export function useRotatingPlaceholder(kind: string | null, active: boolean): string {
  const pool = placeholdersForKind(kind);
  const [index, setIndex] = useState(0);

  // A different kind swaps the whole pool — restart from its first line
  // rather than landing on whatever index the previous pool happened to be at.
  useEffect(() => {
    setIndex(0);
  }, [kind]);

  useEffect(() => {
    if (!active || pool.length <= 1) return;
    const timer = window.setInterval(
      () => setIndex((i) => nextPlaceholderIndex(i, pool.length)),
      ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [active, pool.length]);

  return pool[index % pool.length] ?? '';
}

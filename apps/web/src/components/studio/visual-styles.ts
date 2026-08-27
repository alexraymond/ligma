/**
 * The direction catalog behind the first-design flow — named visual
 * directions a new design can start from.
 *
 * Data vendored from open-design (Apache-2.0), commit d5aa1002,
 * `apps/web/src/runtime/visual-style-catalog.ts` — the 26 entries of its
 * `prototype` context (slug, title, description, variant, recommended).
 *
 * Ligma changes: only the prototype catalog is carried (decks, documents,
 * images and video are not Studio kinds); each entry's remote `.webp` preview
 * asset is dropped — nothing here fetches from a CDN — and the `swatch`
 * triples below are ours, a CSS stand-in keyed off the upstream `variant`.
 * The UI on top of this data is a rebuild, not a port.
 *
 * The picked direction lands in the prompt textarea as visible text: the user
 * reads it, edits it, or deletes it. Nothing is appended to a turn behind
 * their back.
 */

export type VisualStyleVariant =
  | 'editorial'
  | 'minimal'
  | 'playful'
  | 'utility'
  | 'luxury'
  | 'brutalist'
  | 'human';

export interface VisualStyle {
  slug: string;
  title: string;
  description: string;
  variant: VisualStyleVariant;
  /** Ours: three CSS colours per variant, so a card can show its mood without an image. */
  swatch: readonly [string, string, string];
  recommended?: boolean;
}

/** Ours — one palette per upstream variant. */
const SWATCH: Record<VisualStyleVariant, readonly [string, string, string]> = {
  editorial: ['#f5efe6', '#1f1b16', '#b4532a'],
  minimal: ['#ffffff', '#e5e7eb', '#111827'],
  playful: ['#ffd166', '#ef476f', '#118ab2'],
  utility: ['#0f172a', '#334155', '#38bdf8'],
  luxury: ['#141414', '#c8a96a', '#f2ede4'],
  brutalist: ['#ffffff', '#000000', '#ff4d00'],
  human: ['#efe7db', '#8a9a5b', '#7a5c3e'],
};

const CATALOG: Omit<VisualStyle, 'swatch'>[] = [
  {
    slug: 'content-led-product',
    title: 'Content-led product',
    description: 'Editorial rhythm, expressive type, and immersive content surfaces.',
    variant: 'editorial',
  },
  {
    slug: 'quiet-saas',
    title: 'Quiet SaaS',
    description: 'Precise spacing, calm controls, and focused product hierarchy.',
    variant: 'minimal',
    recommended: true,
  },
  {
    slug: 'expressive-consumer',
    title: 'Expressive consumer',
    description: 'Friendly color, rounded interactions, and moments of delight.',
    variant: 'playful',
  },
  {
    slug: 'dense-utility',
    title: 'Dense utility',
    description: 'Compact navigation and information-rich expert workflows.',
    variant: 'utility',
  },
  {
    slug: 'premium-commerce',
    title: 'Premium commerce',
    description: 'Image-led layouts, refined details, and deliberate restraint.',
    variant: 'luxury',
  },
  {
    slug: 'experimental-interface',
    title: 'Experimental interface',
    description: 'Graphic contrast, raw structure, and unconventional interaction cues.',
    variant: 'brutalist',
  },
  {
    slug: 'friendly-service',
    title: 'Friendly service',
    description: 'Comfortable density, reassuring language, and welcoming surfaces.',
    variant: 'human',
  },
  {
    slug: 'mobile-native',
    title: 'Mobile-native',
    description: 'Touch-first cards, concise task flows, and clear thumb reach.',
    variant: 'minimal',
  },
  {
    slug: 'brand-landing',
    title: 'Brand landing',
    description: 'Image-led hero storytelling with an unmistakable conversion path.',
    variant: 'editorial',
  },
  {
    slug: 'soft-glass',
    title: 'Soft glass',
    description: 'Frosted panels, pale gradients, and soft controlled depth.',
    variant: 'minimal',
  },
  {
    slug: 'neo-brutalist',
    title: 'Neo-brutalist',
    description: 'Bold outlines, chunky controls, and direct energetic interactions.',
    variant: 'brutalist',
  },
  {
    slug: 'spatial-3d',
    title: 'Spatial 3D',
    description: 'Dimensional cards and floating objects that clarify hierarchy.',
    variant: 'playful',
  },
  {
    slug: 'social-community',
    title: 'Social community',
    description: 'Colorful participation cues and approachable discovery.',
    variant: 'playful',
  },
  {
    slug: 'marketplace',
    title: 'Marketplace',
    description: 'Visual product grids with easy browsing, comparison, and trust.',
    variant: 'utility',
  },
  {
    slug: 'monochrome-terminal',
    title: 'Monochrome terminal',
    description: 'Dense commands, reliable status, and technical precision.',
    variant: 'utility',
  },
  {
    slug: 'editorial-print',
    title: 'Editorial print',
    description: 'Warm paper, serif rhythm, and magazine-like reading flow.',
    variant: 'editorial',
  },
  {
    slug: 'cinematic-dark',
    title: 'Cinematic dark',
    description: 'Immersive dark imagery with quiet navigation and dramatic contrast.',
    variant: 'editorial',
  },
  {
    slug: 'swiss-minimal',
    title: 'Swiss minimal',
    description: 'Precise grid, red geometric accents, and disciplined whitespace.',
    variant: 'minimal',
  },
  {
    slug: 'retro-pop',
    title: 'Retro pop',
    description: 'Tangerine, mustard, sky blue, and a bright consumer energy.',
    variant: 'playful',
  },
  {
    slug: 'tech-futurist',
    title: 'Tech futurist',
    description: 'Credible AI and data surfaces with cyan and violet signals.',
    variant: 'utility',
  },
  {
    slug: 'organic-natural',
    title: 'Organic natural',
    description: 'Sustainable material cues, gentle curves, and warm earth tones.',
    variant: 'human',
  },
  {
    slug: 'photojournal',
    title: 'Photojournal',
    description: 'Photography-forward evidence and concise supporting context.',
    variant: 'editorial',
  },
  {
    slug: 'y2k-chrome',
    title: 'Y2K chrome',
    description: 'Glossy chrome, translucent layers, and electric early-web optimism.',
    variant: 'playful',
  },
  {
    slug: 'paper-craft',
    title: 'Paper craft',
    description: 'Tactile cut-paper layers, warm shadows, and calm navigation.',
    variant: 'human',
  },
  {
    slug: 'isometric',
    title: 'Isometric',
    description: 'Spatial system maps and dimensional cards for complex product flows.',
    variant: 'utility',
  },
  {
    slug: 'aurora-dark',
    title: 'Aurora dark',
    description: 'Near-black surfaces with quiet luminous gradients and premium depth.',
    variant: 'minimal',
  },
];

/** The catalog, recommended direction first. */
export const VISUAL_STYLES: VisualStyle[] = CATALOG.map((entry) => ({
  ...entry,
  swatch: SWATCH[entry.variant],
})).sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false));

/** How a picked direction reads in the textarea. Also how it is recognised again. */
export const DIRECTION_PREFIX = 'Visual direction: ';

export function stylePromptFragment(style: VisualStyle): string {
  return `${DIRECTION_PREFIX}${style.title} — ${style.description}`;
}

/**
 * Put `style`'s fragment in the prompt — replacing any direction already there,
 * so picking a second card swaps the direction instead of stacking two.
 * `null` removes the direction and leaves the user's own prose untouched.
 */
export function withStyleDirection(prompt: string, style: VisualStyle | null): string {
  const kept = prompt
    .split('\n')
    .filter((line) => !line.startsWith(DIRECTION_PREFIX))
    .join('\n')
    .trimEnd();
  if (!style) return kept;
  const fragment = stylePromptFragment(style);
  return kept === '' ? fragment : `${kept}\n\n${fragment}`;
}

/**
 * Which direction the prompt currently carries. The textarea is the only
 * source of truth for the pick — edit the line away and the card un-presses.
 */
export function styleInPrompt(prompt: string): VisualStyle | null {
  const line = prompt.split('\n').find((l) => l.startsWith(DIRECTION_PREFIX));
  if (!line) return null;
  return VISUAL_STYLES.find((style) => line === stylePromptFragment(style)) ?? null;
}

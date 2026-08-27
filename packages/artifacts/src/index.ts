/**
 * @ligma/artifacts — the streaming parser for Claude-style
 * `<artifact ...>...</artifact>` tags.
 *
 * Feed it assistant text deltas as they arrive; it emits ordered
 * artifact:start / artifact:chunk / artifact:end / text events so a host can
 * render prose and design source separately without buffering the whole turn.
 * Parsing only — no fs, no network, no provider knowledge.
 */
export {
  createArtifactParser,
  type ArtifactEvent,
  type ArtifactStartEvent,
  type ArtifactChunkEvent,
  type ArtifactEndEvent,
  type TextEvent,
} from './parser';

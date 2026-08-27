/**
 * The Studio's public surface.
 *
 * `PromoteSheet` is the one other workstreams need: the brief entrance opens
 * the *same* sheet with `source={{ brief }}` (UX spec F1.4 — two entrances, one
 * review sheet), so importing it from here is what keeps the headless path from
 * drifting into a second, lesser flow.
 */

export { StudioSurface } from './studio-surface';
export { PromoteSheet, type PromoteSheetProps, type PromoteSource } from './promote-sheet';
export { CritiqueLane, type CritiqueLaneProps } from './critique-lane';
export { VersionRail, type VersionRailProps } from './version-rail';
export { TweaksPanel, type TweaksPanelProps } from './tweaks-panel';
export { PinChips, type PinChipsProps } from './pin-chips';
export {
  PinOverlay,
  pinVisualState,
  pinStyleFromRect,
  type PinRect,
  type PinVisualState,
} from './pin-overlay';
export { Wall, type WallProps } from './wall';
export { CanvasViewport, clampZoom, MIN_ZOOM, MAX_ZOOM } from './canvas-viewport';
export { FocusPreview, type DeviceViewport, type PinTarget } from './focus-preview';
export { DesignSystemPicker, type DesignSystemPickerProps } from './design-system-picker';
export { DesignGallery, designMeta } from './design-gallery';
export { DirectionCards, StarterPrompts } from './direction-cards';
export {
  VISUAL_STYLES,
  DIRECTION_PREFIX,
  styleInPrompt,
  stylePromptFragment,
  withStyleDirection,
  type VisualStyle,
} from './visual-styles';
export { StudioPaperTokens } from './paper';
export { TranscriptPane, type TranscriptPaneProps } from './transcript-pane';
export {
  filesProduced,
  foldTranscript,
  mergeEntry,
  messageCopyText,
  userPromptFor,
} from './transcript';
export { useDesign, type DesignLive, type DesignConnectionState } from './use-design';
export { buildDesignSrcdoc, buildThumbnailSrcdoc, stablePreviewSourceKey } from './srcdoc';
export { createKeyedThrottle, FS_THROTTLE_MS, type KeyedThrottle } from './throttle';
export {
  comparePair,
  controlFor,
  pinAppliedIn,
  stagedPins,
  studioVisible,
  toggleCompare,
  type ComparePair,
  type DesignState,
} from './api';
export {
  extractScreenTitle,
  processGestureMove,
  processGestureUp,
  reorderPaths,
  startGesture,
  DRAG_THRESHOLD_PX,
  type GestureState,
  type PointerUpEffect,
} from './gesture';

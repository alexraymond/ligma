/**
 * The workspace panels' public surface — References, Design Files, Notes
 * (OD-048, OD-137, OD-134, OD-138), the three fixed pipeline-strip slots.
 */

export { ReferencesPanel } from './references-panel';
export { DesignFilesPanel } from './design-files-panel';
export { NotesPanel, formatNoteTimestamp } from './notes-panel';
export {
  listReferences,
  addLinkReference,
  addScreenshotReference,
  deleteReference,
  listDesignFiles,
  uploadDesignFile,
  deleteDesignFile,
  listNotes,
  addNote,
  type ReferenceItem,
  type ReferenceLink,
  type ReferenceScreenshot,
  type DesignFileItem,
  type NoteMessage,
} from './workspace-api';

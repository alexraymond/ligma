/**
 * Field and collection limits enforced by the daemon's request validation and
 * mirrored by the web forms, so a form never lets you type past what the API
 * will accept.
 */

/** Default max items returned by GET endpoints when no ?limit is specified */
export const DEFAULT_LIMIT = 200;

export const LIMITS = {
  TITLE: 200,
  DESCRIPTION: 5000,
  NOTES: 5000,
  BODY: 5000,
  CONTENT: 5000,
  CONTEXT: 5000,
  SUBJECT: 500,
  QUESTION: 500,
  ANSWER: 500,
  SUBTASK_TITLE: 500,
  COMMENT_CONTENT: 5000,
  TAG: 100,
  MAX_SUBTASKS: 100,
  MAX_DAILY_ACTIONS: 100,
  MAX_COMMENTS: 100,
  MAX_BLOCKED_BY: 50,
  MAX_CRITERIA: 50,
  MAX_TAGS: 50,
  MAX_MILESTONES: 50,
  MAX_TASKS: 50,
  MAX_OPTIONS: 20,
  MAX_MINUTES: 99999,
} as const;

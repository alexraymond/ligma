// Canonical definitions live in @ligma/shared to avoid a
// circular dependency: packages/providers needs LoadedSkill but
// packages/providers is already a dependency of packages/core.
// Re-export here so skill-internal code can import from './types.js'.
export { SkillFrontmatterV1 } from '@ligma/shared';
export type { LoadedSkill } from '@ligma/shared';

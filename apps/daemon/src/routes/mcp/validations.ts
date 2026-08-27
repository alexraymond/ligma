/**
 * zod schemas for the external MCP server registry (OD-101).
 *
 * Field limits are pulled from store/validations.ts's LIMITS table rather than
 * invented here, so a registry entry's name is capped the same way every other
 * title field in the app is.
 */
import { z } from 'zod';
import { LIMITS } from '../../store/validations';

const transportEnum = z.enum(['stdio', 'http']);

export const mcpServerCreateSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(LIMITS.TITLE),
    transport: transportEnum,
    command: z.string().max(500).nullable().optional().default(null),
    args: z.array(z.string().max(200)).max(20).optional().default([]),
    url: z.string().max(1000).nullable().optional().default(null),
    enabled: z.boolean().optional().default(true),
  })
  .refine((b) => (b.transport === 'stdio' ? !!b.command?.trim() : !!b.url?.trim()), {
    message: 'stdio servers need a command; http servers need a url',
    path: ['command'],
  });

export const mcpServerUpdateSchema = z.object({
  name: z.string().min(1).max(LIMITS.TITLE).optional(),
  transport: transportEnum.optional(),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string().max(200)).max(20).optional(),
  url: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional(),
});

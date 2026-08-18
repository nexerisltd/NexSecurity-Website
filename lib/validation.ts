import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const roleSchema = z.enum(['USER', 'ADMIN']);
export const statusSchema = z.enum(['ACTIVE', 'DISABLED']);

export const addAuthorizedUserSchema = z.object({
  email: emailSchema,
  role: roleSchema.default('USER'),
});

export const updateAuthorizedUserSchema = z.object({
  role: roleSchema.optional(),
  status: statusSchema.optional(),
});

const safeUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((val) => val.startsWith('https://'), 'URL must use https');

export const boardSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thumbnail_url: safeUrl.optional().nullable(),
  sort_order: z.number().int().min(0).max(100000).default(0),
  published: z.boolean().default(false),
  destination_page_id: z.string().uuid().nullable().optional(),
});

export const boardUpdateSchema = boardSchema.partial();

export const pageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thumbnail_url: safeUrl.optional().nullable(),
  sort_order: z.number().int().min(0).max(100000).default(0),
  layout: z.enum(['grid', 'list']).default('grid'),
});

export const videoSchema = z.object({
  board_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thumbnail_url: safeUrl.optional().nullable(),
  // Bunny Stream is the only supported provider — one less thing to get
  // wrong when attaching a class, and one less code path to secure.
  provider: z.literal('bunny').default('bunny'),
  // "{libraryId}/{videoGuid}" — e.g.
  // "503487/df2a65b4-d422-4c13-9327-44081b6f5f4f", taken straight out of
  // the embed URL https://iframe.mediadelivery.net/embed/{libraryId}/{videoGuid}
  source_ref: z.string().trim().min(1).max(2048),
});

export const videoUpdateSchema = videoSchema.partial().extend({
  board_id: z.string().uuid().optional(),
});

export const uuidSchema = z.string().uuid();

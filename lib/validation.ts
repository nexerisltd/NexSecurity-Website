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
  provider: z.enum(['supabase_storage', 'mux', 'cloudflare_stream']).default('supabase_storage'),
  source_ref: z.string().trim().min(1).max(2048),
});

export const uuidSchema = z.string().uuid();

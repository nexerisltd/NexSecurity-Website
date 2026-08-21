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
  restrict_devices: z.boolean().optional(),
});

export const deviceApprovalSchema = z.object({
  ip_address: z.string().trim().min(1).max(64),
  device_label: z.string().trim().min(1).max(80),
});

const safeUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((val) => val.startsWith('https://'), 'URL must use https');

export const boardTypeSchema = z.enum(['normal', 'routine']);

export const boardSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thumbnail_url: safeUrl.optional().nullable(),
  sort_order: z.number().int().min(0).max(100000).default(0),
  published: z.boolean().default(false),
  destination_page_id: z.string().uuid().nullable().optional(),
  // 'routine' boards skip the normal board/video hierarchy entirely and
  // just display routine_image_url (a class routine / timetable graphic,
  // 16:9) alongside the title and description.
  board_type: boardTypeSchema.default('normal'),
  routine_image_url: safeUrl.optional().nullable(),
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
  // Which part this is within the board, when a board has more than one
  // class attached (Part 1, Part 2, ...).
  sort_order: z.number().int().min(0).max(100000).default(0),
  // A single dedicated download link for this class.
  download_url: safeUrl.optional().nullable(),
});

export const videoUpdateSchema = videoSchema.partial().extend({
  board_id: z.string().uuid().optional(),
});

// A resource attached to a class — a lecture sheet, an exam link, notes,
// etc. Deliberately generic (just a title + URL) rather than a fixed set
// of resource "kinds", so admins aren't boxed in.
export const videoResourceSchema = z.object({
  video_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  url: safeUrl,
  sort_order: z.number().int().min(0).max(100000).default(0),
});

// A downloadable e-book attached to a board (chapter/subject). Deliberately
// separate from video_resources: e-books are their own browsable section
// on a board's page, with a price (almost always 0 / "Free") rather than
// being a link attached to a specific class.
export const eBookSchema = z.object({
  board_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  thumbnail_url: safeUrl.optional().nullable(),
  download_url: safeUrl.optional().nullable(),
  format: z.string().trim().min(1).max(40).default('PDF'),
  price: z.number().min(0).max(1000000).default(0),
  sort_order: z.number().int().min(0).max(100000).default(0),
});

export const eBookUpdateSchema = eBookSchema.partial().extend({
  board_id: z.string().uuid().optional(),
});

export const uuidSchema = z.string().uuid();

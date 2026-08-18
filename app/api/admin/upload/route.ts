import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Thumbnails are intentionally public (they're marketing-style preview
 * images, not protected content) — this uploads to a PUBLIC bucket and
 * returns a permanent public URL, unlike the video playback route. If
 * that's ever not true for your use case, don't reuse this pattern for
 * anything that needs to stay private.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  const rl = checkRateLimit(`admin_upload:${auth.user.email}`, 20, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPG, PNG, WEBP, or GIF images are allowed.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 5MB).' }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await adminClient.storage
    .from('thumbnails')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }

  const { data: publicUrl } = adminClient.storage.from('thumbnails').getPublicUrl(path);

  return NextResponse.json({ url: publicUrl.publicUrl });
}

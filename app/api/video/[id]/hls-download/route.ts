import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthorized } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAuditEvent } from '@/lib/audit';
import { hlsPullZoneConfigured, buildHlsMasterUrl } from '@/lib/bunny';

export const dynamic = 'force-dynamic';
// Vercel Hobby caps this at 60s regardless of this value; Pro/Enterprise
// can go higher. A long lecture recording may still hit the platform
// ceiling — if that happens the native Bunny MP4-rendition download
// (once Bunny's issue is fixed) remains the reliable path for long videos.
export const maxDuration = 300;

type Variant = { label: string; url: string };

/**
 * Same authorization gate as /api/video/[id]/download — repeated here on
 * purpose (see that route's comment) rather than shared, since this route
 * is an equally sensitive leak surface.
 */
async function authorizeAndLoadVideo(videoId: string, email: string) {
  const adminClient = createSupabaseAdminClient();
  const { data: video } = await adminClient
    .from('videos')
    .select('id, title, provider, source_ref, board:board_id(id, published)')
    .eq('id', videoId)
    .maybeSingle();

  const board = video?.board as unknown as { id: string; published: boolean } | null;
  if (!video || !board || !board.published || video.provider !== 'bunny') {
    await logAuditEvent('VIDEO_ACCESS_DENIED', email, videoId, { reason: 'hls_download_denied' });
    return null;
  }

  const [libraryId, bunnyVideoId] = video.source_ref.split('/');
  if (!libraryId || !bunnyVideoId) return null;

  return { bunnyVideoId, title: (video.title as string) ?? 'class-video' };
}

/** Pulls RESOLUTION/label + URI pairs out of a master playlist. Falls back
 * to treating the fetched playlist itself as the only variant when it has
 * no #EXT-X-STREAM-INF lines (i.e. it's already a media playlist). */
function parseVariants(masterText: string, masterUrl: string): Variant[] {
  const lines = masterText.split('\n').map((l) => l.trim());
  const variants: Variant[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uriLine = lines[i + 1];
    if (!uriLine || uriLine.startsWith('#')) continue;

    const resMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);
    const absoluteUrl = new URL(uriLine, masterUrl).toString();
    const folderMatch = absoluteUrl.match(/\/(\d+p)\//);
    const label = folderMatch ? folderMatch[1] : resMatch ? `${resMatch[1]}p` : `variant-${variants.length + 1}`;

    variants.push({ label, url: absoluteUrl });
  }

  if (variants.length === 0) {
    variants.push({ label: 'default', url: masterUrl });
  }
  return variants;
}

/** Pulls segment URIs (in order) out of a media/variant playlist. */
function parseSegments(variantText: string, variantUrl: string): { segments: string[]; encrypted: boolean } {
  const lines = variantText.split('\n').map((l) => l.trim());
  const segments: string[] = [];
  let encrypted = false;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY') && !line.includes('METHOD=NONE')) encrypted = true;
    if (!line || line.startsWith('#')) continue;
    segments.push(new URL(line, variantUrl).toString());
  }
  return { segments, encrypted };
}

/** GET without ?resolution= lists available resolutions.
 *  GET with ?resolution=240p streams that resolution as a downloadable file. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthorized();
  if (!auth.ok) return NextResponse.json({ error: 'Access denied.' }, { status: auth.status });

  if (!hlsPullZoneConfigured()) {
    return NextResponse.json({ error: 'Downloads are not configured yet.' }, { status: 503 });
  }

  const parsedId = uuidSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  const resolved = await authorizeAndLoadVideo(parsedId.data, auth.user.email);
  if (!resolved) return NextResponse.json({ error: 'Access denied.' }, { status: 404 });

  const resolution = request.nextUrl.searchParams.get('resolution');

  const masterUrl = buildHlsMasterUrl(resolved.bunnyVideoId);
  const masterRes = await fetch(masterUrl, { cache: 'no-store' });
  if (!masterRes.ok) {
    return NextResponse.json({ error: 'Video stream is not currently available.' }, { status: 502 });
  }
  const masterText = await masterRes.text();
  const variants = parseVariants(masterText, masterUrl);

  // --- List mode ---
  if (!resolution) {
    const rl = checkRateLimit(`hls_download_list:${auth.user.email}`, 20, 60_000);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
    return NextResponse.json({ resolutions: variants.map((v) => v.label) });
  }

  // --- Stream/download mode ---
  const rl = checkRateLimit(`hls_download:${auth.user.email}`, 6, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many download requests. Slow down.' }, { status: 429 });
  }

  const variant = variants.find((v) => v.label === resolution);
  if (!variant) return NextResponse.json({ error: 'That resolution is not available.' }, { status: 400 });

  const variantRes = await fetch(variant.url, { cache: 'no-store' });
  if (!variantRes.ok) {
    return NextResponse.json({ error: 'Video stream is not currently available.' }, { status: 502 });
  }
  const variantText = await variantRes.text();
  const { segments, encrypted } = parseSegments(variantText, variant.url);

  if (encrypted) {
    return NextResponse.json(
      { error: 'This video is encrypted and cannot be downloaded this way yet.' },
      { status: 501 }
    );
  }
  if (segments.length === 0) {
    return NextResponse.json({ error: 'No video segments found.' }, { status: 502 });
  }

  await logAuditEvent('VIDEO_ACCESS_GRANTED', auth.user.email, parsedId.data, {
    action: 'HLS_DOWNLOAD',
    resolution: variant.label,
    segmentCount: segments.length,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const segUrl of segments) {
          const segRes = await fetch(segUrl, { cache: 'no-store' });
          if (!segRes.ok || !segRes.body) throw new Error(`Segment fetch failed: ${segUrl}`);
          const reader = segRes.body.getReader();
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        console.error('[hls-download] stream failed', err);
        controller.error(err);
      }
    },
  });

  const safeTitle = resolved.title.replace(/[^\w\-]+/g, '_').slice(0, 80) || 'class-video';

  return new Response(stream, {
    headers: {
      'Content-Type': 'video/mp2t',
      'Content-Disposition': `attachment; filename="${safeTitle}_${variant.label}.ts"`,
      'Cache-Control': 'no-store',
    },
  });
}

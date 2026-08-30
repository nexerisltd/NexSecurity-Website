import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? '';

// Downloads are currently disabled site-wide (the button was removed from
// the video page too). Gated behind an env var, rather than deleted or
// hard-returned, so re-enabling later is a one-line config change and the
// rest of this route stays live/type-checked instead of going dead code.
const DOWNLOADS_ENABLED = process.env.ENABLE_VIDEO_DOWNLOADS === 'true';

/**
 * Some Bunny pull zones have hotlink/User-Agent protection that quietly
 * rejects plain server-to-server fetches (no Referer, generic runtime UA)
 * while the exact same URL opens fine in a real browser tab. These
 * headers make our serverless fetch look like a normal browser request
 * from this site, which is what the pull zone's allow-list expects.
 */
function bunnyFetchHeaders(): HeadersInit {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...(SITE_URL ? { Referer: SITE_URL, Origin: SITE_URL } : {}),
  };
}

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

/** One HLS segment plus whatever AES-128 key/IV state applied to it at
 * that point in the playlist (Bunny's default HLS encryption — plain
 * AES-128, not proprietary DRM, so it's decryptable with the delivered key). */
type Segment = { url: string; keyUri: string | null; iv: Buffer | null; seq: number };

/** Per HLS spec: if the #EXT-X-KEY tag has no IV attribute, the IV is the
 * segment's media sequence number as a 16-byte big-endian integer. */
function seqToIv(seq: number): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt32BE(seq >>> 0, 12);
  return buf;
}

/** Pulls segment URIs (in order) out of a media/variant playlist, tracking
 * any #EXT-X-KEY state so encrypted segments can be decrypted later.
 * Returns drm=true only for real DRM (Widevine/FairPlay/SAMPLE-AES) which
 * genuinely can't be decrypted this way — plain AES-128 is handled. */
function parseSegments(
  variantText: string,
  variantUrl: string
): { segments: Segment[]; drm: boolean } {
  const lines = variantText.split('\n').map((l) => l.trim());
  const segments: Segment[] = [];
  let drm = false;
  let seq = 0;
  let currentKeyUri: string | null = null;
  let currentIv: Buffer | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      const m = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      if (m) seq = parseInt(m[1], 10);
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const methodMatch = line.match(/METHOD=([^,]+)/);
      const method = methodMatch ? methodMatch[1] : null;
      if (!method || method === 'NONE') {
        currentKeyUri = null;
        currentIv = null;
      } else if (method === 'AES-128') {
        const uriMatch = line.match(/URI="([^"]+)"/);
        currentKeyUri = uriMatch ? new URL(uriMatch[1], variantUrl).toString() : null;
        const ivMatch = line.match(/IV=0[xX]([0-9A-Fa-f]+)/);
        currentIv = ivMatch ? Buffer.from(ivMatch[1].padStart(32, '0'), 'hex') : null;
      } else {
        // SAMPLE-AES, real DRM (Widevine/FairPlay via KEYFORMAT), etc — no key we can use.
        drm = true;
      }
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    segments.push({
      url: new URL(line, variantUrl).toString(),
      keyUri: currentKeyUri,
      iv: currentIv,
      seq,
    });
    seq++;
  }
  return { segments, drm };
}

/** GET without ?resolution= lists available resolutions.
 *  GET with ?resolution=240p streams that resolution as a downloadable file. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!DOWNLOADS_ENABLED) {
    return NextResponse.json({ error: 'Downloads are currently disabled.' }, { status: 403 });
  }

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
  const masterRes = await fetch(masterUrl, { cache: 'no-store', headers: bunnyFetchHeaders() });
  if (!masterRes.ok) {
    const bodySnippet = (await masterRes.text().catch(() => '')).slice(0, 200);
    console.error('[hls-download] master fetch failed', masterRes.status, masterUrl, bodySnippet);
    return NextResponse.json(
      { error: `Video stream is not currently available. (CDN ${masterRes.status})` },
      { status: 502 }
    );
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

  const variantRes = await fetch(variant.url, { cache: 'no-store', headers: bunnyFetchHeaders() });
  if (!variantRes.ok) {
    console.error('[hls-download] variant fetch failed', variantRes.status, variant.url);
    return NextResponse.json(
      { error: `Video stream is not currently available. (CDN ${variantRes.status})` },
      { status: 502 }
    );
  }
  const variantText = await variantRes.text();
  const { segments, drm } = parseSegments(variantText, variant.url);

  if (drm) {
    return NextResponse.json(
      { error: 'This video uses real DRM protection and cannot be downloaded this way.' },
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
    encrypted: segments.some((s) => s.keyUri !== null),
  });

  // AES-128 keys are tiny (16 bytes) and typically shared across every
  // segment in the playlist — fetch each distinct key URI once and reuse.
  const keyCache = new Map<string, Promise<Buffer>>();
  function getKey(keyUri: string): Promise<Buffer> {
    let pending = keyCache.get(keyUri);
    if (!pending) {
      pending = fetch(keyUri, { cache: 'no-store', headers: bunnyFetchHeaders() }).then(async (res) => {
        if (!res.ok) throw new Error(`Key fetch failed (${res.status}): ${keyUri}`);
        return Buffer.from(await res.arrayBuffer());
      });
      keyCache.set(keyUri, pending);
    }
    return pending;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const seg of segments) {
          const segRes = await fetch(seg.url, { cache: 'no-store', headers: bunnyFetchHeaders() });
          if (!segRes.ok) {
            throw new Error(`Segment fetch failed (${segRes.status}): ${seg.url}`);
          }
          const raw = Buffer.from(await segRes.arrayBuffer());

          if (seg.keyUri) {
            const keyBytes = await getKey(seg.keyUri);
            const iv = seg.iv ?? seqToIv(seg.seq);
            const decipher = crypto.createDecipheriv('aes-128-cbc', keyBytes, iv);
            controller.enqueue(new Uint8Array(Buffer.concat([decipher.update(raw), decipher.final()])));
          } else {
            controller.enqueue(new Uint8Array(raw));
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

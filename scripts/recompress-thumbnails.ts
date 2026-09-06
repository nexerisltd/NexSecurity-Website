/**
 * One-off maintenance script — NOT part of the deployed app, never
 * imported by any page or API route. Re-compresses every existing
 * image in the "thumbnails" Supabase Storage bucket IN PLACE (same
 * path, same public URL — nothing in the database needs to change)
 * using the same resize/re-encode approach components/ThumbnailUpload.tsx
 * now runs on every NEW upload. Only needed because everything uploaded
 * BEFORE that change is still sitting at its original, often much
 * larger, size.
 *
 * SETUP (one time):
 *   npm install sharp
 *
 * DRY RUN FIRST (strongly recommended — this overwrites real files):
 *   DRY_RUN=1 npx tsx scripts/recompress-thumbnails.ts
 *
 * THEN FOR REAL:
 *   npx tsx scripts/recompress-thumbnails.ts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which
 * this script reads directly out of .env.local / .env (Next.js only
 * auto-loads those inside `next dev`/`next build`, not for a script run
 * directly with tsx/node, hence the small loader below).
 *
 * Safety net: before overwriting anything remotely, the ORIGINAL bytes
 * are saved to ./thumbnail-backups/<path> so a mistake here is
 * recoverable without digging through Supabase's own version history.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const BUCKET = 'thumbnails';
const MAX_DIMENSION = 1600;
const QUALITY = 82;
// Anything already smaller than this is left alone — not worth the risk
// of a marginal re-encode, and keeps re-runs fast.
const SKIP_UNDER_BYTES = 300 * 1024;
const BACKUP_DIR = resolve(process.cwd(), 'thumbnail-backups');
const DRY_RUN = process.env.DRY_RUN === '1';

function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env.local and .env).');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function formatKB(bytes: number) {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

async function main() {
  if (DRY_RUN) console.log('--- DRY RUN: nothing will actually be uploaded ---\n');

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data: entries, error } = await supabase.storage.from(BUCKET).list('', { limit, offset });
    if (error) {
      console.error('Could not list bucket contents:', error.message);
      process.exit(1);
    }
    if (!entries || entries.length === 0) break;

    for (const entry of entries) {
      const path = entry.name;
      if (!path) continue;

      const sizeBefore = entry.metadata?.size ?? 0;
      if (path.toLowerCase().endsWith('.gif')) {
        console.log(`- skip (gif, would lose animation): ${path}`);
        skipped++;
        continue;
      }
      if (sizeBefore && sizeBefore < SKIP_UNDER_BYTES) {
        console.log(`- skip (already small, ${formatKB(sizeBefore)}): ${path}`);
        skipped++;
        continue;
      }

      try {
        const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
        if (downloadError || !blob) throw downloadError ?? new Error('empty download');

        const inputBuffer = Buffer.from(await blob.arrayBuffer());
        const outputBuffer = await sharp(inputBuffer)
          .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toBuffer();

        if (outputBuffer.length >= inputBuffer.length) {
          console.log(`- skip (recompress didn't help): ${path}`);
          skipped++;
          continue;
        }

        // Backup the ORIGINAL before touching anything remote.
        const backupPath = resolve(BACKUP_DIR, path);
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, inputBuffer);

        if (!DRY_RUN) {
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, outputBuffer, { contentType: 'image/webp', upsert: true });
          if (uploadError) throw uploadError;
        }

        processed++;
        bytesBefore += inputBuffer.length;
        bytesAfter += outputBuffer.length;
        console.log(
          `${DRY_RUN ? '(would update)' : '✓'} ${path}: ${formatKB(inputBuffer.length)} → ${formatKB(outputBuffer.length)}`
        );
      } catch (err) {
        failed++;
        console.error(`✗ failed: ${path}:`, err instanceof Error ? err.message : err);
      }
    }

    if (entries.length < limit) break;
    offset += limit;
  }

  console.log('\n--- Done ---');
  console.log(`Processed: ${processed}, skipped: ${skipped}, failed: ${failed}`);
  if (processed > 0) {
    console.log(
      `Total: ${(bytesBefore / 1024 / 1024).toFixed(2)}MB → ${(bytesAfter / 1024 / 1024).toFixed(2)}MB ` +
        `(saved ${((bytesBefore - bytesAfter) / 1024 / 1024).toFixed(2)}MB)`
    );
  }
  if (!DRY_RUN && processed > 0) {
    console.log(`Originals backed up to: ${BACKUP_DIR}`);
  }
}

main();

'use client';

/**
 * Downscales + re-encodes an image FILE in the browser, before it ever
 * reaches the network. This exists so a phone photo or a full-res
 * screenshot doesn't get uploaded (and stored, and served to every
 * visitor) at its original multi-megabyte size just because it's being
 * used as a small thumbnail — Vercel's Image Optimization used to do
 * this resizing on the way OUT to visitors, but that's a metered
 * service with a monthly quota; doing it once here, on the way IN,
 * means every thumbnail is already small and there's nothing left for
 * a paid optimization step to usefully do.
 *
 * Deliberately conservative about when it's safe to use the result:
 * - GIFs are returned untouched — re-encoding through <canvas> would
 *   collapse an animation down to its first frame.
 * - If anything about compression fails (old browser, decode error,
 *   canvas unsupported), the ORIGINAL file is returned rather than
 *   blocking the upload — a slightly large thumbnail beats no
 *   thumbnail.
 * - If the "compressed" result somehow comes out larger than the
 *   original (can happen with a source image that's already small and
 *   efficiently encoded), the original is kept instead.
 */
export async function compressImageFile(
  file: File,
  { maxDimension = 1600, quality = 0.82 }: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  if (file.type === 'image/gif') return file;
  if (typeof createImageBitmap === 'undefined') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./\\]+$/, '') + '.webp';
    return new File([blob], newName, { type: 'image/webp' });
  } catch {
    return file;
  }
}

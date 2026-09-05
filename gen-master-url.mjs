// One-off helper: prints the correct Bunny HLS *master* playlist URL
// (signed if token auth is on) using the same env vars the app already
// uses for its other Bunny features. Run from the project root with the
// project's own .env.local loaded, e.g.:
//
//   node -r dotenv/config gen-master-url.mjs <bunnyVideoId>
//
// <bunnyVideoId> is the GUID you can already see in your current
// (wrong) variant URL — the part between the hostname and the
// resolution folder, e.g. in
//   https://vz-XXXX.b-cdn.net/6a82d91c-0dad-22af-5717-5f22xxxxxxxx/1080p/video.m3u8
// it's "6a82d91c-0dad-22af-5717-5f22xxxxxxxx".

import crypto from 'crypto';

const PULL_ZONE_HOSTNAME = process.env.BUNNY_PULL_ZONE_HOSTNAME;
const TOKEN_AUTH_ENABLED = process.env.BUNNY_TOKEN_AUTH_ENABLED === 'true';
const TOKEN_AUTH_SECURITY_KEY = process.env.BUNNY_TOKEN_AUTH_SECURITY_KEY;

const bunnyVideoId = process.argv[2];
if (!bunnyVideoId) {
  console.error('Usage: node -r dotenv/config gen-master-url.mjs <bunnyVideoId>');
  process.exit(1);
}
if (!PULL_ZONE_HOSTNAME) {
  console.error('BUNNY_PULL_ZONE_HOSTNAME is not set in your env — check .env.local');
  process.exit(1);
}

function signPath(path, expires) {
  const hashable = `${TOKEN_AUTH_SECURITY_KEY}${path}${expires}`;
  const raw = crypto.createHash('sha256').update(hashable).digest('base64');
  return raw.replace(/\n/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const path = `/${bunnyVideoId}/playlist.m3u8`;
const base = `https://${PULL_ZONE_HOSTNAME}${path}`;

if (!TOKEN_AUTH_ENABLED) {
  console.log(base);
} else {
  if (!TOKEN_AUTH_SECURITY_KEY) {
    console.error('BUNNY_TOKEN_AUTH_ENABLED is true but BUNNY_TOKEN_AUTH_SECURITY_KEY is missing.');
    process.exit(1);
  }
  const ttlSeconds = 60 * 60 * 24 * 30; // 30 days — long enough to paste into the admin form and test
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = signPath(path, expires);
  console.log(`${base}?token=${token}&expires=${expires}`);
}

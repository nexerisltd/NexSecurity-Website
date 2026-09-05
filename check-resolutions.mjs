// Checks which resolutions Bunny has ACTUALLY finished encoding for a
// given video, using the Stream API key already in your env (same one
// the app's download feature already relies on) — no Bunny dashboard
// login needed.
//
// Run (Node 20+):
//   node --env-file=.env.local check-resolutions.mjs <bunnyVideoId> [libraryId]
//
// <bunnyVideoId> is the GUID, e.g. 0afbb74f-5a9d-4036-a4af-7177c16c2828
// [libraryId] optional — if omitted, uses BUNNY_STREAM_LIBRARY_ID from env

const API_KEY = process.env.BUNNY_STREAM_API_KEY;
const DEFAULT_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID;

const bunnyVideoId = process.argv[2];
const libraryId = process.argv[3] || DEFAULT_LIBRARY_ID;

if (!bunnyVideoId) {
  console.error('Usage: node --env-file=.env.local check-resolutions.mjs <bunnyVideoId> [libraryId]');
  process.exit(1);
}
if (!API_KEY) {
  console.error('BUNNY_STREAM_API_KEY is not set in your env — check .env.local');
  process.exit(1);
}
if (!libraryId) {
  console.error('No libraryId given and BUNNY_STREAM_LIBRARY_ID is not set in your env.');
  process.exit(1);
}

const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${bunnyVideoId}`, {
  headers: { AccessKey: API_KEY, Accept: 'application/json' },
});

if (!res.ok) {
  console.error(`Bunny API returned ${res.status} — check the videoId/libraryId are right.`);
  process.exit(1);
}

const data = await res.json();
console.log('title:', data.title);
console.log('status (4 = finished encoding all requested resolutions):', data.status);
console.log('availableResolutions (actually finished encoding):', data.availableResolutions || '(none reported)');
console.log('encodeProgress %:', data.encodeProgress);

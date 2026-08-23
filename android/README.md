# Android app — one-time setup

Everything AFTER this one-time step is fully automated by
`.github/workflows/build-android.yml` — runs on GitHub's servers, works
regardless of local power/internet.

This step only needs to happen ONCE (or again if you ever change the app
name, package ID, or icons). It's interactive, so it can't run inside the
GitHub Actions workflow itself — but it doesn't need to run on your own
machine either. Use **GitHub Codespaces** (a free, cloud-hosted dev
environment attached to this repo) so load-shedding/local outages don't
block it.

## Steps

1. On this repo's GitHub page: **Code → Codespaces → Create codespace on
   main**. Wait for it to finish loading (cloud machine, not your PC).

2. In the Codespace terminal:
   ```bash
   npm install -g @bubblewrap/cli
   bubblewrap init --manifest="https://nexsecurity.vercel.app/manifest.json"
   ```

3. It will ask several questions — press Enter to accept the value it
   read from manifest.json for most of them. Specifically confirm/enter:
   - **Package ID**: `com.nexapp.nexsecurity` (must match
     `public/.well-known/assetlinks.json` exactly — do not let it
     auto-generate a different one)
   - **Signing key**: choose **"Use my own"** and point it at your
     existing keystore — if you don't have the keystore file itself in
     the Codespace, choose "Create new" instead ONLY if you're issuing a
     brand new key (this would require updating
     `public/.well-known/assetlinks.json` with the new fingerprint and
     re-verifying, since the existing one is tied to your current
     keystore). If you still have the original keystore file, upload it
     into the Codespace first (drag-and-drop into the file explorer) and
     point init at that path instead of creating a new one.

4. This produces a `twa-manifest.json` file at the repo root (and an
   `android/` project folder, which you do NOT need to commit — only
   `twa-manifest.json` is needed; `bubblewrap build` regenerates the rest
   from it every time).

5. Commit and push just the manifest:
   ```bash
   git add twa-manifest.json
   git commit -m "chore: add twa-manifest.json for Android build"
   git push
   ```

6. From now on: **Actions tab → Build Android App → Run workflow**
   whenever you want a fresh signed build. Download the APK/AAB from the
   run's "Artifacts" section.

## If step 2's automated prompts feel unreliable

Bubblewrap's own maintainers acknowledge `init` doesn't fully automate
cleanly even in a terminal (GitHub issue #806) — if it hangs or asks
something unexpected, that's a known rough edge, not something broken on
your end. Answering its prompts once, by hand, in the Codespace is the
reliable path; everything after that (every future rebuild) is the fully
automated workflow.

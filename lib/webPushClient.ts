// PushManager wants the VAPID public key as a raw Uint8Array, not the
// base64url string it's normally handed around as everywhere else.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Whether THIS browser can do web push at all, independent of whether
 * permission has been granted yet. false on, notably: iOS/iPadOS Safari
 * unless the site has been added to the Home Screen and is running as
 * an installed, standalone app (Apple only shipped Web Push for
 * installed PWAs, never for a normal Safari tab, even on 16.4+) — which
 * is exactly the "installed the app but still don't see an option"
 * report this exists to explain rather than silently hide.
 */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export type PushStatus = 'unsupported' | 'denied' | 'default' | 'granted';

/** Coarse status for deciding what to show — separate from
 * "is there an active subscription row in our own DB", which the
 * caller has to check server-side (see /api/push/subscribe); this is
 * purely what the BROWSER currently reports. */
export function getPushStatus(): PushStatus {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission as PushStatus;
}

// TEMPORARY — remove this once the mobile subscribe issue is confirmed
// fixed. Surfaces the exact failure reason as an on-screen alert so it
// can be read on a phone with no DevTools/USB-debugging access at all.
const DEBUG_ALERT = true;

/**
 * Requests permission (if not already decided) and subscribes this
 * browser to push, POSTing the subscription to /api/push/subscribe.
 * Always the result of an explicit user click — browsers increasingly
 * punish sites that call Notification.requestPermission() without one.
 */
export async function subscribeToPush(): Promise<{ ok: boolean; status: PushStatus }> {
  if (!isPushSupported()) {
    if (DEBUG_ALERT) alert('[push debug] not supported: Notification/serviceWorker/PushManager missing from this browser.');
    return { ok: false, status: 'unsupported' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    if (DEBUG_ALERT) alert(`[push debug] permission not granted: "${permission}"`);
    return { ok: false, status: permission as PushStatus };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    if (DEBUG_ALERT) alert('[push debug] NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing from this build.');
    return { ok: false, status: 'granted' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast needed because TS's DOM lib types Uint8Array as backed by
      // the more general ArrayBufferLike (which also covers
      // SharedArrayBuffer) while BufferSource wants a plain
      // ArrayBuffer specifically — Uint8Array.from() below always
      // allocates a normal ArrayBuffer at runtime, so this is safe.
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });

    // fetch() only throws on a network-level failure — a 400/401/500
    // response still resolves normally, so without this check a
    // rejected subscribe would be silently reported as a success.
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (DEBUG_ALERT) alert(`[push debug] /api/push/subscribe failed: ${res.status} ${res.statusText}\n${text}`);
      throw new Error(`subscribe POST failed: ${res.status}`);
    }

    if (DEBUG_ALERT) alert('[push debug] subscribed successfully — endpoint saved.');
    return { ok: true, status: 'granted' };
  } catch (err) {
    // Permission was granted but the actual subscribe (or the POST)
    // failed — still "granted" from the browser's point of view, just
    // not usefully subscribed.
    if (DEBUG_ALERT && err instanceof Error && !err.message.startsWith('subscribe POST failed')) {
      alert(`[push debug] pushManager.subscribe() threw: ${err.message}`);
    }
    return { ok: false, status: 'granted' };
  }
}

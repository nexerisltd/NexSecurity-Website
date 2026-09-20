'use client';

import { useEffect } from 'react';

/**
 * Mounted once in app/learn/layout.tsx so it covers every class page
 * (board listing, video page, ebooks, routines) without repeating this
 * in each page. Blocks the native context menu only — does not touch
 * text selection or devtools, since neither can actually be prevented
 * from the page side and pretending otherwise just adds noise.
 *
 * This also happens to be the Android half of long-press/save-image
 * protection: Chrome for Android fires a real `contextmenu` event on a
 * long-press over an image/video, so this same preventDefault() covers
 * it. iOS Safari's equivalent long-press menu is native OS UI that
 * never dispatches a JS event at all — that half is handled by the
 * .protected-content CSS rule in app/globals.css instead (see the
 * comment there for why it has to be CSS, not JS).
 */
export function DisableRightClick() {
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return null;
}

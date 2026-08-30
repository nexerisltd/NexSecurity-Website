'use client';

import { useEffect } from 'react';

/**
 * Mounted once in app/learn/layout.tsx so it covers every class page
 * (board listing, video page, ebooks, routines) without repeating this
 * in each page. Blocks the native context menu only — does not touch
 * text selection or devtools, since neither can actually be prevented
 * from the page side and pretending otherwise just adds noise.
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

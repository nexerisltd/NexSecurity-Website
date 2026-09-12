import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import { RegisterServiceWorker } from '@/components/RegisterServiceWorker';
import { SitePopup } from '@/components/SitePopup';
import { NotificationPrompt } from '@/components/NotificationPrompt';
import { DeviceSignalCollector } from '@/components/DeviceSignalCollector';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NexSecurity — Private Learning Space',
  description: 'Authorized members only.',
  robots: { index: false, follow: false },
  icons: { icon: '/logo.png', shortcut: '/logo.png', apple: '/logo.png' },
  verification: { google: '7VfuwzozReuUwaodd5kmJAMF9HbifQWHX0aU-EUfpYg' },
  manifest: '/manifest.json',
  themeColor: '#3D6EFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Warms the TLS/TCP connection to the stream Worker (see worker/src/
  // index.ts) before any video is even opened, so the very first
  // playlist/segment request on a lecture page doesn't also have to pay
  // for a fresh handshake to a brand-new origin — that one-time cost is
  // small on WiFi but noticeable on mobile data, which is exactly where
  // "slow to start" was being felt most.
  const streamWorkerBase = process.env.NEXT_PUBLIC_STREAM_WORKER_BASE;
  return (
    <html lang="en" className={`${manrope.variable} ${mono.variable}`}>
      {streamWorkerBase ? (
        <head>
          <link rel="preconnect" href={streamWorkerBase} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={streamWorkerBase} />
        </head>
      ) : null}
      <body className="min-h-screen bg-vault-950 font-body text-ink antialiased">
        <RegisterServiceWorker />
        <SitePopup />
        <NotificationPrompt />
        <Suspense fallback={null}>
          <DeviceSignalCollector />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

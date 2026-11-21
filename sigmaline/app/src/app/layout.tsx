import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SwRegister } from '@/components/sw-register';

export const metadata: Metadata = {
  title: { default: 'Sigmaline — simulated fair prices for every game', template: '%s · Sigmaline' },
  description: 'Every game simulated 10,000 times. Fair prices, EV and a verifiable track record. Information only.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Sigmaline', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: '#0A0A0A', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Self-hosted IBM Plex (OFL), latin subset: no render-blocking third-party CSS. */}
        <link rel="preload" href="/fonts/plex-mono-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/plex-mono-600.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-amber focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}

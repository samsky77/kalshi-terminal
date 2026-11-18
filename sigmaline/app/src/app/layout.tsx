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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-amber focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}

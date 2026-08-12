import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'opsz'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['500'],
});

const generalSans = localFont({
  src: [
    { path: './fonts/GeneralSans-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/GeneralSans-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/GeneralSans-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-general-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SLYDSHOW',
  description: 'Remake TikTok photo carousels with studio photos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${jetbrainsMono.variable} ${generalSans.variable}`}
    >
      <body className="h-screen overflow-hidden bg-surface font-sans text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}

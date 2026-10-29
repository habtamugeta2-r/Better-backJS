import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Better Back — Express clarity, built for TypeScript',
    template: '%s | Better Back',
  },
  description:
    'Documentation for Better Back, the TypeScript-first Express 5 framework with Stage-3 decorators, Zod contracts, and explicit dependency injection.',
  openGraph: {
    title: 'Better Back',
    description: 'A clearer way to build TypeScript backends.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

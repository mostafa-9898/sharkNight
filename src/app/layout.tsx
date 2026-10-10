import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TradeBot - Crypto Backtesting Terminal',
  description: 'Automated Trading & Backtesting Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


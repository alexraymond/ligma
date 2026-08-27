import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LayoutShell } from '@/components/layout-shell';
import { ThemeProvider } from '@/components/theme-provider';
import { CollectionsProvider } from '@/providers/collections-provider';
import { DeckQueueProvider } from '@/providers/deck-queue-provider';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Ligma',
  description:
    'The command center for humans supervising AI agents — Eisenhower matrix, Kanban, objectives, and agent deployment',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <ThemeProvider>
          {/* One cache for the always-on collections, so a mutation on one
              surface reaches every surface derived from it. */}
          <CollectionsProvider>
            {/* Above the shell so the rail badge and the Deck page read one count. */}
            <DeckQueueProvider>
              <LayoutShell>{children}</LayoutShell>
            </DeckQueueProvider>
          </CollectionsProvider>
          <Toaster
            theme="system"
            position="bottom-right"
            toastOptions={{
              className: 'border-border bg-card text-card-foreground',
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}

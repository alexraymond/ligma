'use client';

import { type SectionTab, sectionTabsFor } from '@/lib/nav';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** One tab row, one look — used by both rail sections and the project space. */
export function TabRow({ tabs, className }: { tabs: SectionTab[]; className?: string }) {
  const pathname = usePathname();
  if (tabs.length === 0) return null;

  return (
    <nav aria-label="Section" className={cn('mb-4 flex items-center gap-1 border-b', className)}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The secondary nav for whichever rail section the current route belongs to.
 * Rendered by the shell, not by pages, so no surface can ship without its
 * siblings visible.
 */
export function SectionTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  return <TabRow tabs={sectionTabsFor(pathname)} className={className} />;
}

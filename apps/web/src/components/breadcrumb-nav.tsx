'use client';

import { cn } from '@/lib/utils';
import { ChevronRight, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function BreadcrumbNav({ items, className }: BreadcrumbNavProps) {
  return (
    <nav className={cn('flex items-center gap-1.5 text-sm', className)} aria-label="Breadcrumb">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <LayoutDashboard className="h-4 w-4" />
        <span>Home</span>
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          {item.href ? (
            <Link
              href={item.href}
              className="max-w-[16rem] truncate text-muted-foreground hover:text-foreground transition-colors"
              title={item.label}
            >
              {item.label}
            </Link>
          ) : (
            <span className="max-w-[16rem] truncate text-foreground font-medium" title={item.label}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

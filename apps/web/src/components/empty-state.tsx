import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6 px-4' : 'py-12 px-6',
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3 mb-3">
        <Icon className={cn('text-muted-foreground', compact ? 'h-5 w-5' : 'h-6 w-6')} />
      </div>
      <h3 className={cn('font-medium text-foreground', compact ? 'text-sm' : 'text-base')}>
        {title}
      </h3>
      <p
        className={cn('text-muted-foreground mt-1 max-w-[280px]', compact ? 'text-xs' : 'text-sm')}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

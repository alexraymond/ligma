import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { Skeleton } from '@/components/ui/skeleton';

/** Home is a door now, not a dashboard — its loading state is one line, not a grid. */
export default function HomeLoading() {
  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[]} />
      <Skeleton className="h-5 w-64" />
    </div>
  );
}

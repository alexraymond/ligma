import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { AgentCardSkeleton } from '@/components/skeletons';

export default function CrewLoading() {
  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Crew' }]} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <AgentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

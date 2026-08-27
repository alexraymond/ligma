import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { EntryRowSkeleton } from '@/components/skeletons';

export default function BrainDumpLoading() {
  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Brain Dump' }]} />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <EntryRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

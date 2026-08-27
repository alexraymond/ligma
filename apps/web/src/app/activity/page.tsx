'use client';

import { BreadcrumbNav } from '@/components/breadcrumb-nav';
import { ErrorState } from '@/components/error-state';
import { EventRowSkeleton } from '@/components/skeletons';
import { useActivityLog, useTasks } from '@/hooks/use-data';
import { Activity } from 'lucide-react';
import { ActivityList } from './activity-list';

export default function ActivityPage() {
  const { events, loading, error: activityError, refetch } = useActivityLog();
  const { tasks } = useTasks();

  if (loading) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Activity' }]} />
        <div className="space-y-2">
          <EventRowSkeleton />
          <EventRowSkeleton />
          <EventRowSkeleton />
          <EventRowSkeleton />
          <EventRowSkeleton />
        </div>
      </div>
    );
  }

  if (activityError) {
    return (
      <div className="space-y-6">
        <BreadcrumbNav items={[{ label: 'Activity Log' }]} />
        <ErrorState message={activityError} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BreadcrumbNav items={[{ label: 'Activity' }]} />

      <h1 className="text-xl font-bold flex items-center gap-2">
        <Activity className="h-5 w-5" />
        Activity Log
      </h1>

      <ActivityList events={events} tasks={tasks} />
    </div>
  );
}

import { Button } from '@/components/ui/button';
import { UserX } from 'lucide-react';
import Link from 'next/link';

export default function AgentNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <UserX className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Agent not found</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-[300px]">
        This agent doesn&apos;t exist or has been removed from the crew.
      </p>
      <Button variant="outline" size="sm" asChild className="mt-4">
        <Link href="/crew">View Crew</Link>
      </Button>
    </div>
  );
}

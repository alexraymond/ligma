import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <FileQuestion className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Page not found</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-[300px]">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button variant="outline" size="sm" asChild className="mt-4">
        <Link href="/">Go to Home</Link>
      </Button>
    </div>
  );
}

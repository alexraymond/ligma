import { redirect } from 'next/navigation';

// Absorbed into Studio's design-files drawer (CONTRACTS-phase3).
export default async function DesignFilesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/studio?panel=design-files`);
}

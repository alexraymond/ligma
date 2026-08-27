import { redirect } from 'next/navigation';

// Absorbed into Build's runs drawer (CONTRACTS-phase3).
export default async function RunsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/board?panel=runs`);
}

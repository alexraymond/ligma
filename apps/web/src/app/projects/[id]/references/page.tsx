import { redirect } from 'next/navigation';

// Absorbed into Brief's references drawer (CONTRACTS-phase3).
export default async function ReferencesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/brief?panel=references`);
}

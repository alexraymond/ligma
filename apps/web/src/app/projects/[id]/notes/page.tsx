import { redirect } from 'next/navigation';

// Absorbed into Build's notes drawer (CONTRACTS-phase3).
export default async function NotesRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/board?panel=notes`);
}

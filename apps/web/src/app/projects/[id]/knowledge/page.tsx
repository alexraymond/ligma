import { redirect } from 'next/navigation';

// Absorbed into Proof's knowledge drawer (CONTRACTS-phase3). The old page's
// body lives on as `knowledge-content.tsx`, which the drawer mounts.
export default async function KnowledgeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/verify?panel=knowledge`);
}

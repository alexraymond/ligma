import { redirect } from 'next/navigation';

// Absorbed into Build's terminal drawer (CONTRACTS-phase3). The old repo-path
// guard moves with the panel content — this shell redirects unconditionally.
export default async function TerminalRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/board?panel=terminal`);
}

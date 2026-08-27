import { redirect } from 'next/navigation';

export default async function SkillRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/library/${id}`);
}

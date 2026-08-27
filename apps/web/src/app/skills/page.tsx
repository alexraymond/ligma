import { redirect } from 'next/navigation';

// Skills are a Library catalog now.
export default function SkillsRedirect() {
  redirect('/library');
}

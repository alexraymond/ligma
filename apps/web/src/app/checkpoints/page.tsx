import { redirect } from 'next/navigation';

export default function CheckpointsRedirect() {
  redirect('/settings/checkpoints');
}

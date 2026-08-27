import { redirect } from 'next/navigation';

// Autopilot status/streams live on Runs; its config moved to Settings.
export default function LaunchRedirect() {
  redirect('/runs');
}

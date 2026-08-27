import { redirect } from 'next/navigation';

// Objectives re-homed into the portfolio grid's goals view (UX spec §16). Old URL kept alive so nothing dead-ends.
export default function ObjectivesRedirect() {
  redirect('/projects?view=goals');
}

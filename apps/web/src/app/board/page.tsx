import { redirect } from 'next/navigation';

// Global Board retired into the portfolio grid's tasks view (UX spec §16). Old URL kept alive so nothing dead-ends.
export default function BoardRedirect() {
  redirect('/projects?view=tasks');
}

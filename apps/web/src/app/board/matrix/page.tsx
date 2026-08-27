import { redirect } from 'next/navigation';

// Priority Matrix retired into the portfolio grid's tasks view (UX spec §16). Old URL kept alive so nothing dead-ends.
export default function BoardMatrixRedirect() {
  redirect('/projects?view=tasks');
}

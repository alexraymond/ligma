import { redirect } from 'next/navigation';

// The Eisenhower matrix survives as a Board view (UX spec §10).
export default function PriorityMatrixRedirect() {
  redirect('/board/matrix');
}

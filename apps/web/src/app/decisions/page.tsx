import { redirect } from 'next/navigation';

// Decisions became the Deck (UX spec §4). Old URL kept alive so nothing dead-ends.
export default function DecisionsRedirect() {
  redirect('/deck');
}

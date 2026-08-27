import { redirect } from 'next/navigation';

// The Deck became the /needs-you tray (UX-REBUILD-BRIEF §Phase 1). Old URL kept alive so nothing dead-ends.
export default function DeckRedirect() {
  redirect('/needs-you');
}

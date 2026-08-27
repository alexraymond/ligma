import { redirect } from 'next/navigation';

// The Inbox merged into the /needs-you tray as items (UX-REBUILD-BRIEF §Phase 1). Old URL kept alive so nothing dead-ends.
export default function InboxRedirect() {
  redirect('/needs-you');
}

import { redirect } from 'next/navigation';

// The status board is now the Board surface's kanban view.
export default function StatusBoardRedirect() {
  redirect('/board');
}

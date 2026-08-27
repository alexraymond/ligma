/**
 * `POST /api/notifications/test` — the Settings → Notifications panel's "Send
 * test notification" button (OD-096). The way to verify the notifier fires
 * without waiting for a real build — the live sites (`harness/verdict.ts` on a
 * verdict, `engine/needs-you-ping.ts` on a ping) only fire when there is
 * something to say.
 */
import { NextResponse } from '../../../http';
import { notifyDesktop } from '../../../notify';

export async function POST(): Promise<Response> {
  notifyDesktop('Ligma', 'Test notification — desktop notifications are working.');
  return NextResponse.json({ message: 'Sent (no-op off macOS or if disabled)' });
}

'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useDaemon } from '@/hooks/use-daemon';
import { apiFetch } from '@/lib/api-client';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * macOS desktop notifications on build completion / verdicts (OD-096).
 *
 * The toggle persists to daemon config and the notifier module exists
 * (apps/daemon/src/notify.ts), but nothing calls it from a real build yet —
 * dispatcher.ts's task-completion site is outside this feature's ownership
 * (see docs/history/CONTRACTS-port1.md row P3), so wiring it in is a one-line handoff
 * rather than something this card can finish. "Send test" is the only way to
 * confirm today that this Mac allows the notification at all.
 */
export function NotificationsCard() {
  const { config, updateConfig } = useDaemon();
  const [sending, setSending] = useState(false);
  const enabled = config.notifications?.desktopEnabled ?? false;

  async function toggle(next: boolean) {
    await updateConfig({ notifications: { desktopEnabled: next } });
  }

  async function sendTest() {
    setSending(true);
    try {
      const res = await apiFetch('/api/notifications/test', { method: 'POST' });
      if (!res.ok) throw new Error('request failed');
      toast.success('Test notification sent (check Notification Center if enabled)');
    } catch {
      toast.error('Failed to reach the daemon');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
        </CardTitle>
        <CardDescription className="mt-1.5">
          macOS desktop notifications when a build finishes verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label
          htmlFor="notify-on-build"
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span>Notify on build completion / verdicts</span>
          <Switch id="notify-on-build" checked={enabled} onCheckedChange={toggle} />
        </label>
        <p className="text-xs text-muted-foreground">
          macOS only (shells <code className="font-mono text-[11px]">osascript</code>) — a no-op on
          other platforms. Not yet fired by real builds; use Send test to confirm this Mac allows
          it.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={sendTest}
          disabled={sending}
        >
          <Bell className="h-3.5 w-3.5" />
          {sending ? 'Sending...' : 'Send test notification'}
        </Button>
      </CardContent>
    </Card>
  );
}

import * as cron from 'node-cron';
import type { Dispatcher } from './dispatcher';
import type { HealthMonitor } from './health';
import { logger } from './logger';
import { maybeCheckAndPingOverdue } from './needs-you-ping';
import { SMOKE_DIGEST_CRON, smokeSchedules } from './smoke';
import type { DaemonConfig } from './types';

type ScheduledTask = ReturnType<typeof cron.schedule>;

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class Scheduler {
  private jobs: Map<string, ScheduledTask> = new Map();
  private pollJob: ScheduledTask | null = null;
  private config: DaemonConfig;
  private dispatcher: Dispatcher;
  private health: HealthMonitor;

  constructor(config: DaemonConfig, dispatcher: Dispatcher, health: HealthMonitor) {
    this.config = config;
    this.dispatcher = dispatcher;
    this.health = health;
  }

  /**
   * Start all configured schedules and the polling loop.
   */
  start(): void {
    logger.info('scheduler', 'Starting scheduler...');

    // Start task polling
    if (this.config.polling.enabled) {
      const cronExpr = `*/${this.config.polling.intervalMinutes} * * * *`;
      logger.info(
        'scheduler',
        `Task polling: every ${this.config.polling.intervalMinutes} minutes (${cronExpr})`,
      );

      this.pollJob = cron.schedule(cronExpr, () => {
        this.dispatcher.pollAndDispatch();
        // Self-throttled to once/hour and self-contained try/catch: a "needs
        // you" check failing must never take the poll loop down with it.
        maybeCheckAndPingOverdue();
      });

      // Calculate next poll time
      this.health.setNextScheduledRun('poll', this.getNextCronRun(cronExpr));
    }

    // Start scheduled commands
    for (const [name, schedule] of Object.entries(this.config.schedule)) {
      if (!schedule.enabled) {
        logger.debug('scheduler', `Schedule "${name}" is disabled, skipping`);
        continue;
      }

      if (!cron.validate(schedule.cron)) {
        logger.error('scheduler', `Invalid cron expression for "${name}": ${schedule.cron}`);
        continue;
      }

      logger.info('scheduler', `Schedule "${name}": ${schedule.cron} → /${schedule.command}`);

      const job = cron.schedule(schedule.cron, () => {
        logger.info(
          'scheduler',
          `Triggered scheduled command: /${schedule.command} (schedule: ${name})`,
        );
        this.dispatcher.runScheduledCommand(schedule.command);
      });

      this.jobs.set(name, job);

      // Calculate next run time
      this.health.setNextScheduledRun(schedule.command, this.getNextCronRun(schedule.cron));
    }

    this.startSmokeJobs();

    const totalJobs = (this.pollJob ? 1 : 0) + this.jobs.size;
    logger.info('scheduler', `Scheduler started with ${totalJobs} active schedule(s)`);

    this.health.flush();
  }

  /**
   * Journey smoke schedules, plus the digest that reports them.
   *
   * Deliberately the same `cron.schedule` and the same `jobs` map as the daemon's
   * own schedules — a journey's cron string is a cron string, and a second
   * scheduling mechanism would be a second thing to stop, reload and get wrong.
   * An invalid expression in a hand-edited journey file is logged and skipped,
   * exactly like an invalid one in the config.
   */
  private startSmokeJobs(): void {
    for (const smoke of smokeSchedules()) {
      const name = `smoke:${smoke.projectId}:${smoke.journeyId}`;
      if (!cron.validate(smoke.cron)) {
        logger.error(
          'scheduler',
          `Invalid smoke schedule for journey ${smoke.journeyId}: ${smoke.cron}`,
        );
        continue;
      }
      logger.info(
        'scheduler',
        `Smoke schedule "${smoke.title}": ${smoke.cron} → journey ${smoke.journeyId}`,
      );
      this.jobs.set(
        name,
        cron.schedule(smoke.cron, () =>
          this.dispatcher.runJourneySmoke(smoke.projectId, smoke.journeyId),
        ),
      );
      this.health.setNextScheduledRun(name, this.getNextCronRun(smoke.cron));
    }

    if (!cron.validate(SMOKE_DIGEST_CRON)) {
      logger.error(
        'scheduler',
        `Invalid smoke digest cron: ${SMOKE_DIGEST_CRON} — no digest will be filed`,
      );
      return;
    }
    logger.info('scheduler', `Smoke digest: ${SMOKE_DIGEST_CRON}`);
    this.jobs.set(
      'smoke-digest',
      // A cron tick is a top-level entry point — there is nobody to await it.
      // `runSmokeDigest` swallows its own errors, so this promise never rejects.
      cron.schedule(SMOKE_DIGEST_CRON, () => void this.dispatcher.runSmokeDigest()),
    );
    this.health.setNextScheduledRun('smoke-digest', this.getNextCronRun(SMOKE_DIGEST_CRON));
  }

  /**
   * Stop all scheduled jobs.
   */
  stop(): void {
    logger.info('scheduler', 'Stopping scheduler...');

    if (this.pollJob) {
      this.pollJob.stop();
      this.pollJob = null;
    }

    for (const [name, job] of this.jobs) {
      job.stop();
      logger.debug('scheduler', `Stopped schedule: ${name}`);
    }
    this.jobs.clear();

    logger.info('scheduler', 'Scheduler stopped');
  }

  /**
   * Reload schedules from updated config.
   */
  reload(newConfig: DaemonConfig): void {
    logger.info('scheduler', 'Reloading scheduler with new config...');
    this.stop();
    this.config = newConfig;
    this.dispatcher.updateConfig(newConfig);
    this.start();
  }

  /**
   * Calculate approximate next run time for a cron expression.
   */
  private getNextCronRun(cronExpr: string): string {
    // Simple approximation — for display purposes
    // node-cron doesn't provide a nextRun method, so we estimate
    try {
      const now = new Date();
      // Parse the cron parts
      const parts = cronExpr.split(' ');
      if (parts.length !== 5) return 'unknown';

      const [min, hour] = parts;

      // If it's a simple "every N minutes" pattern
      if (min.startsWith('*/')) {
        const interval = Number.parseInt(min.slice(2));
        const nextMinute = Math.ceil(now.getMinutes() / interval) * interval;
        const next = new Date(now);
        next.setMinutes(nextMinute, 0, 0);
        if (next <= now) next.setMinutes(next.getMinutes() + interval);
        return next.toISOString();
      }

      // For specific times
      if (min !== '*' && hour !== '*') {
        const targetHour = Number.parseInt(hour);
        const targetMin = Number.parseInt(min);
        const next = new Date(now);
        next.setHours(targetHour, targetMin, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next.toISOString();
      }

      return 'scheduled';
    } catch {
      return 'unknown';
    }
  }
}

import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scrubCredentials } from './security';
import type { LogLevel } from './types';

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_LOG_SIZE = 1_000_000; // 1MB
const MAX_ROTATIONS = 3;
import { DATA_DIR } from '../paths';
const LOG_FILE = path.join(DATA_DIR, 'daemon.log');

// ─── Log Rotation ────────────────────────────────────────────────────────────

function rotateIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stats = statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate: daemon.log.2 → daemon.log.3, daemon.log.1 → daemon.log.2, etc.
    for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // Rotation failure is non-fatal
  }
}

// ─── Logger ──────────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[90m', // gray
  INFO: '\x1b[36m', // cyan
  WARN: '\x1b[33m', // yellow
  ERROR: '\x1b[31m', // red
  SECURITY: '\x1b[35m', // magenta
};
const RESET = '\x1b[0m';

class DaemonLogger {
  private minLevel: LogLevel = 'INFO';

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SECURITY'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private format(level: LogLevel, module: string, message: string): string {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return `[${now}] [${level}] [${module}] ${message}`;
  }

  log(level: LogLevel, module: string, message: string): void {
    if (!this.shouldLog(level)) return;

    // Scrub credentials from ALL log output
    const safeMessage = scrubCredentials(message);
    const formatted = this.format(level, module, safeMessage);

    // Console output with colors
    const color = LEVEL_COLORS[level];
    console.log(`${color}${formatted}${RESET}`);

    // File output (no colors)
    try {
      rotateIfNeeded();
      writeFileSync(LOG_FILE, `${formatted}\n`, { flag: 'a' });
    } catch {
      // File write failure is non-fatal
    }
  }

  debug(module: string, message: string): void {
    this.log('DEBUG', module, message);
  }

  info(module: string, message: string): void {
    this.log('INFO', module, message);
  }

  warn(module: string, message: string): void {
    this.log('WARN', module, message);
  }

  error(module: string, message: string): void {
    this.log('ERROR', module, message);
  }

  security(module: string, message: string): void {
    this.log('SECURITY', module, message);
  }
}

export const logger = new DaemonLogger();

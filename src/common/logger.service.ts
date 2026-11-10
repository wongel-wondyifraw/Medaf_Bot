import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Central error logger shared across the bot:
 *   1. Mirrors errors to the Nest console logger for hosted logs.
 *   2. Appends formatted entries to logs/errors.log on disk for health reports.
 */
@Injectable()
export class FileLoggerService {
  private readonly logger = new Logger('FileLoggerService');
  private readonly logDir = path.join(process.cwd(), 'logs');
  private readonly errorLog = path.join(this.logDir, 'errors.log');

  constructor() {
    try {
      if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
    } catch (err) {
      const e = err as Error;
      this.logger.warn(`Could not create log dir: ${e.message}`);
    }
  }

  logError(scope: string, err: unknown, extra: Record<string, unknown> = {}): void {
    const stamp = new Date().toISOString();
    const e = err as { code?: string; message?: string; stack?: string };
    const code = e?.code ? `[${e.code}] ` : '';
    const message = e?.message || String(err);
    const stack = e?.stack || '';
    const meta = Object.keys(extra).length ? `\n${JSON.stringify(extra)}` : '';
    const line = `[${stamp}] [${scope}] ${code}${message}${meta}\n${stack}\n---\n`;
    this.logger.error(line);
    try {
      fs.appendFileSync(this.errorLog, line);
    } catch (writeErr) {
      const w = writeErr as Error;
      this.logger.error(`Failed to write error log: ${w.message}`);
    }
  }
}

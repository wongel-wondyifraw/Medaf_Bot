import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Central logger shared across the bot. Three behaviours combined:
 *
 *   1. Mirrors every entry to the Nest console logger so Render's "Logs"
 *      tab always shows what is happening.
 *   2. Appends errors to logs/errors.log on disk (kept from the original
 *      implementation so existing health/report code keeps working).
 *   3. Exposes info/warn/debug helpers so feature code does not have to
 *      instantiate its own Nest Logger when it wants structured output.
 *
 * The class is intentionally lightweight: synchronous, no batching, no
 * external service. The point is to never lose a message — even if a
 * downstream provider fails, the console log still appears in Render.
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

  info(scope: string, message: string, extra: Record<string, unknown> = {}): void {
    new Logger(scope).log(this.format(message, extra));
  }

  warn(scope: string, message: string, extra: Record<string, unknown> = {}): void {
    new Logger(scope).warn(this.format(message, extra));
  }

  debug(scope: string, message: string, extra: Record<string, unknown> = {}): void {
    new Logger(scope).debug(this.format(message, extra));
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

  private format(message: string, extra: Record<string, unknown>): string {
    if (!Object.keys(extra).length) return message;
    try {
      return `${message} ${JSON.stringify(extra)}`;
    } catch {
      return message;
    }
  }

  static isNetworkError(err: unknown): boolean {
    if (!err) return false;
    const e = err as { code?: string; message?: string };
    const code = e.code || '';
    return (
      ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code) ||
      /timeout/i.test(e.message || '') ||
      /fetch failed/i.test(e.message || '')
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileLoggerService {
  private readonly logger = new Logger('FileLoggerService');
  private readonly logDir = path.join(process.cwd(), 'logs');
  private readonly errorLog = path.join(this.logDir, 'errors.log');

  constructor() {
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
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

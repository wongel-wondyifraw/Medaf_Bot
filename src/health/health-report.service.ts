import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatGmtPlus3 } from '../common/date-format';
import { AppConfig } from '../config/configuration';
import { OrdersService } from '../orders/orders.service';
import { HealthLogService } from './health-log.service';

/** How far back we scan `logs/errors.log` for the critical-log section. */
const LOG_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Max critical log lines included in one Telegram message. */
const MAX_CRITICAL_LINES = 12;

/**
 * Lines in errors.log that mention these scopes or error signatures are
 * treated as operationally critical. Everything else is omitted from the
 * health report so the owner only sees what needs attention.
 */
const CRITICAL_SCOPES = new Set([
  'orderConfirm',
  'orderConfirmEdit',
  'cancel',
  'adminReport',
  'adminSettings',
  'adminPending',
  'adminMarkDone',
  'adminCategories',
  'applyUserPrice',
  'orderDraftRender',
  'editMessage',
]);

const CRITICAL_MESSAGE_PATTERNS = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /EAI_AGAIN/i,
  /database/i,
  /postgres/i,
  /migration/i,
  /BOT_TOKEN/i,
  /USD_TO_ETB/i,
  /fatal/i,
  /uncaught/i,
  /unhandled/i,
  /startup failed/i,
  /network error/i,
];

export interface CriticalLogEntry {
  timestamp: Date;
  scope: string;
  summary: string;
}

@Injectable()
export class HealthReportService {
  private readonly bootedAt = Date.now();
  private readonly errorLogPath = path.join(process.cwd(), 'logs', 'errors.log');

  constructor(
    private readonly healthLog: HealthLogService,
    private readonly orders: OrdersService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * True when `telegramId` is the configured health-report recipient
   * (default 1041346091). Used to gate the admin-panel health button.
   */
  isHealthReportRecipient(telegramId: number | string): boolean {
    const configured = this.config.get('healthReportChatId', { infer: true });
    return configured !== '' && String(telegramId) === configured;
  }

  getHealthReportChatId(): string {
    return this.config.get('healthReportChatId', { infer: true });
  }

  /**
   * Builds the full HTML health report. Safe to send via Telegram
   * `parse_mode: 'HTML'` (all dynamic segments are escaped).
   */
  async buildReportMessage(): Promise<string> {
    const [orderStats, healthBatches, pendingPings, criticalLogs] = await Promise.all([
      this.orders.getReport(),
      this.healthLog.getReport(3),
      Promise.resolve(this.healthLog.getPending()),
      Promise.resolve(this.readCriticalLogs(LOG_LOOKBACK_MS)),
    ]);

    const mem = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());
    const lines: string[] = [
      '<b>🩺 Medaf Bot — Health Report</b>',
      `<i>Generated ${this.escapeHtml(formatGmtPlus3(new Date()))}</i>`,
      '',
      '<b>System</b>',
      `• Status: <b>OK</b>`,
      `• Process uptime: <b>${this.formatDuration(uptimeSec)}</b>`,
      `• Host uptime: <b>${this.formatDuration(Math.floor(os.uptime()))}</b>`,
      `• Node: <b>${process.version}</b>`,
      `• Platform: <b>${os.platform()} ${os.arch()}</b>`,
      `• PID: <code>${process.pid}</code>`,
      '',
      '<b>Memory</b>',
      `• RSS: <b>${this.formatBytes(mem.rss)}</b>`,
      `• Heap used: <b>${this.formatBytes(mem.heapUsed)}</b> / ${this.formatBytes(mem.heapTotal)}`,
      `• External: <b>${this.formatBytes(mem.external)}</b>`,
      '',
      '<b>Orders (all time)</b>',
      `• Pending: <b>${orderStats.pending}</b>   Cancelled: <b>${orderStats.cancelled}</b>   Completed: <b>${orderStats.completed}</b>`,
      `• Revenue (non-cancelled): <b>${orderStats.totalRevenueEtb.toLocaleString('en-US')} ETB</b>`,
      `• Last 24h: <b>${orderStats.last24hCount}</b> order(s)`,
      '',
      '<b>Health pings</b>',
    ];

    if (pendingPings.pingCount > 0) {
      const since = pendingPings.firstPingAt
        ? formatGmtPlus3(pendingPings.firstPingAt)
        : '—';
      lines.push(
        `• In-memory batch: <b>${pendingPings.pingCount}</b> ping(s) since ${this.escapeHtml(since)}`,
      );
    } else {
      lines.push('• In-memory batch: <i>empty (awaiting pings)</i>');
    }

    if (healthBatches.length === 0) {
      lines.push('• Last flushed batch: <i>none yet</i>');
    } else {
      const latest = healthBatches[0];
      lines.push(
        `• Last flushed: <b>${latest.pingCount}</b> pings ` +
          `(${this.escapeHtml(formatGmtPlus3(latest.firstPingAt))} → ${this.escapeHtml(formatGmtPlus3(latest.lastPingAt))})`,
      );
    }

    lines.push('', '<b>Critical log (last 24h)</b>');
    if (criticalLogs.length === 0) {
      lines.push('<i>No critical errors recorded.</i>');
    } else {
      const shown = criticalLogs.slice(0, MAX_CRITICAL_LINES);
      for (const entry of shown) {
        lines.push(
          `• <code>${this.escapeHtml(formatGmtPlus3(entry.timestamp))}</code> ` +
            `[${this.escapeHtml(entry.scope)}] ${this.escapeHtml(entry.summary)}`,
        );
      }
      if (criticalLogs.length > MAX_CRITICAL_LINES) {
        lines.push(
          `<i>…and ${criticalLogs.length - MAX_CRITICAL_LINES} more critical entries.</i>`,
        );
      }
    }

    lines.push('', `<i>Bot session started ${this.escapeHtml(formatGmtPlus3(new Date(this.bootedAt)))}</i>`);
    return lines.join('\n');
  }

  /**
   * Parses `logs/errors.log` and returns only entries that match our
   * critical scope list or message patterns within the lookback window.
   */
  readCriticalLogs(lookbackMs: number): CriticalLogEntry[] {
    if (!fs.existsSync(this.errorLogPath)) return [];

    let raw: string;
    try {
      raw = fs.readFileSync(this.errorLogPath, 'utf8');
    } catch {
      return [];
    }

    const cutoff = Date.now() - lookbackMs;
    const blocks = raw.split('\n---\n').filter((b) => b.trim().length > 0);
    const entries: CriticalLogEntry[] = [];

    for (const block of blocks) {
      const parsed = this.parseErrorBlock(block);
      if (!parsed) continue;
      if (parsed.timestamp.getTime() < cutoff) continue;
      if (!this.isCritical(parsed.scope, parsed.message)) continue;
      entries.push({
        timestamp: parsed.timestamp,
        scope: parsed.scope,
        summary: parsed.message.slice(0, 120),
      });
    }

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private parseErrorBlock(
    block: string,
  ): { timestamp: Date; scope: string; message: string } | null {
    const lines = block.trim().split('\n');
    if (lines.length === 0) return null;

    // Format: [ISO] [scope] message
    const header = lines[0];
    const match = header.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/);
    if (!match) return null;

    const timestamp = new Date(match[1]);
    if (Number.isNaN(timestamp.getTime())) return null;

    return {
      timestamp,
      scope: match[2],
      message: match[3].trim(),
    };
  }

  private isCritical(scope: string, message: string): boolean {
    if (CRITICAL_SCOPES.has(scope)) return true;
    return CRITICAL_MESSAGE_PATTERNS.some((re) => re.test(message));
  }

  private formatDuration(totalSeconds: number): string {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0 || seconds > 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

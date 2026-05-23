import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { HealthReportService } from './health-report.service';

@Injectable()
export class HealthNotificationsService {
  private readonly logger = new Logger(HealthNotificationsService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly healthReport: HealthReportService,
  ) {}

  /**
   * Sends a full health report to the configured super-admin chat once
   * every 24 hours (midnight server time). The HTTP /health endpoint
   * behaviour is unchanged — this is an additive notification layer.
   */
  @Cron('0 0 0 * * *', { name: 'daily-health-report' })
  async sendDailyHealthReport(): Promise<void> {
    const chatId = this.healthReport.getHealthReportChatId();
    if (!chatId) {
      this.logger.debug('HEALTH_REPORT_CHAT_ID not set, skipping daily report.');
      return;
    }
    await this.deliverReport(chatId, 'daily cron');
  }

  /**
   * On-demand delivery used by the admin-panel button and the cron job.
   */
  async deliverReport(chatId: string | number, trigger: string): Promise<void> {
    try {
      const body = await this.healthReport.buildReportMessage();
      await this.bot.telegram.sendMessage(chatId, body, { parse_mode: 'HTML' });
      this.logger.log(`Health report sent to ${chatId} (${trigger}).`);
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Failed to send health report to ${chatId}: ${e.message}`);
    }
  }
}

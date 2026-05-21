import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { OrdersService } from '../orders/orders.service';
import { AdminsService } from './admins.service';

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly admins: AdminsService,
    private readonly orders: OrdersService,
  ) {}

  @Cron('0 0 */6 * * *', { name: 'admin-order-digest' })
  async notifyAdmins(): Promise<void> {
    const allAdmins = await this.admins.findAll();
    if (allAdmins.length === 0) {
      this.logger.debug('No admins configured, skipping digest.');
      return;
    }

    const now = new Date();
    for (const admin of allAdmins) {
      try {
        const since = admin.lastNotifiedAt || admin.addedAt;
        const newOrders = await this.orders.findCreatedSince(since);
        if (newOrders.length === 0) {
          this.logger.debug(`No new orders for admin ${admin.id} since ${since.toISOString()}.`);
          continue;
        }

        const message = this.formatDigest(since, newOrders);
        await this.bot.telegram.sendMessage(admin.telegramId, message, {
          parse_mode: 'HTML',
        });
        await this.admins.updateLastNotified(admin.id, now);
        this.logger.log(
          `Sent ${newOrders.length} new order(s) digest to admin ${admin.id}.`,
        );
      } catch (err) {
        const e = err as Error;
        this.logger.error(`Failed to notify admin ${admin.id}: ${e.message}`);
      }
    }
  }

  private formatDigest(since: Date, orders: Awaited<ReturnType<OrdersService['findCreatedSince']>>): string {
    const sinceStr = since.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const lines: string[] = [
      `<b>📦 ${orders.length} new order(s) since ${sinceStr}</b>`,
      '',
    ];
    const previewLimit = 15;
    for (const o of orders.slice(0, previewLimit)) {
      const r = (o as unknown as { reseller?: { fullName?: string | null; phoneNumber?: string | null } }).reseller;
      const name = r?.fullName || 'unknown';
      const phone = r?.phoneNumber || '';
      const title = (o.productTitle || '').slice(0, 60);
      const price = o.sellingEtb.toLocaleString('en-US');
      const statusTag = o.status === 'pending' ? '⏳' : o.status === 'cancelled' ? '✗' : '✓';
      lines.push(`${statusTag} <b>#${o.id}</b> ${title} — ${price} ETB`);
      lines.push(`   by ${name}${phone ? ' (' + phone + ')' : ''}`);
    }
    if (orders.length > previewLimit) {
      lines.push('', `…and ${orders.length - previewLimit} more.`);
    }
    return lines.join('\n');
  }
}

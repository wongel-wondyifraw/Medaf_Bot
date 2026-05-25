import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { formatGmtPlus3 } from '../common/date-format';
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
        const newOrders = await this.orders.findCreatedSince(since, 'pending');
        if (newOrders.length === 0) {
          this.logger.debug(
            `No new pending orders for admin ${admin.id} since ${since.toISOString()}.`,
          );
          await this.admins.updateLastNotified(admin.id, now);
          continue;
        }

        const message = this.formatDigest(since, newOrders);
        await this.bot.telegram.sendMessage(admin.telegramId, message, {
          parse_mode: 'HTML',
        });
        await this.admins.updateLastNotified(admin.id, now);
        this.logger.log(
          `Sent ${newOrders.length} new pending order(s) digest to admin ${admin.id}.`,
        );
      } catch (err) {
        const e = err as Error;
        this.logger.error(`Failed to notify admin ${admin.id}: ${e.message}`);
      }
    }
  }

  private formatDigest(since: Date, orders: Awaited<ReturnType<OrdersService['findCreatedSince']>>): string {
    const sinceStr = formatGmtPlus3(since);
    const lines: string[] = [
      `<b>📦 ${orders.length} new pending order(s) since ${this.escapeHtml(sinceStr)}</b>`,
      '',
    ];
    const previewLimit = 15;
    for (const o of orders.slice(0, previewLimit)) {
      const r = (o as unknown as { reseller?: { fullName?: string | null; phoneNumber?: string | null } }).reseller;
      const name = this.escapeHtml(r?.fullName || 'unknown');
      const phone = this.escapeHtml(r?.phoneNumber || '');
      const title = this.escapeHtml((o.productTitle || '').slice(0, 60));
      const statusTag = '⏳';

      const total = o.sellingEtb.toLocaleString('en-US');
      const priceBase =
        o.quantity > 1 && o.unitEtb
          ? `${o.unitEtb.toLocaleString('en-US')} × ${o.quantity} = ${total} ETB`
          : `${total} ETB`;
      const usdTail = this.formatUsdTail(o);
      const priceLine = usdTail ? `${priceBase} ${usdTail}` : priceBase;

      const variantParts: string[] = [];
      if (o.size) variantParts.push(o.size);
      if (o.color) variantParts.push(o.color);
      if (o.quantity > 1) variantParts.push(`×${o.quantity}`);
      const variant = variantParts.length
        ? this.escapeHtml(variantParts.join(' · '))
        : null;

      lines.push(`${statusTag} <b>#${o.id}</b> ${title} — ${priceLine}`);
      lines.push(`   Placed: ${this.escapeHtml(formatGmtPlus3(o.createdAt))}`);
      if (variant) lines.push(`   ${variant}`);
      lines.push(`   by ${name}${phone ? ' (' + phone + ')' : ''}`);
      if (o.link) {
        lines.push(`   <a href="${this.escapeHtml(o.link)}">View product</a>`);
      }
    }
    if (orders.length > previewLimit) {
      lines.push('', `…and ${orders.length - previewLimit} more.`);
    }
    return lines.join('\n');
  }

  private formatUsd(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return '$' + value.toFixed(2);
  }

  private formatUsdTail(order: {
    userUnitUsd: number | null;
    scrapedUnitUsd: number | null;
  }): string {
    const user = order.userUnitUsd;
    const scraped = order.scrapedUnitUsd;
    if (user == null && scraped == null) return '';
    const used = user ?? scraped;
    if (used == null) return '';
    const overrode =
      user != null && scraped != null && Math.abs(user - scraped) >= 0.01;
    if (overrode) {
      return `(${this.formatUsd(used)} USD, scraped ${this.formatUsd(scraped)})`;
    }
    return `(${this.formatUsd(used)} USD)`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

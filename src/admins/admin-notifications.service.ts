import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { formatGmtPlus3 } from '../common/date-format';
import { Order } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { AdminsService } from './admins.service';
import { orderApprovalInlineKeyboard } from './order-approval-inline';

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly admins: AdminsService,
    private readonly orders: OrdersService,
  ) {}

  async notifyAdminsNewOrder(order: Order): Promise<void> {
    const allAdmins = await this.admins.findAll();
    if (allAdmins.length === 0) return;

    const full = await this.orders.findByIdWithReseller(order.id);
    if (!full) return;

    const message = this.formatNewOrderAlert(full);
    const keyboard = orderApprovalInlineKeyboard(order.id);
    for (const admin of allAdmins) {
      try {
        await this.bot.telegram.sendMessage(admin.telegramId, message, {
          parse_mode: 'HTML',
          ...keyboard,
        });
      } catch (err) {
        const e = err as Error;
        this.logger.error(`Failed to alert admin ${admin.id} about order #${order.id}: ${e.message}`);
      }
    }
  }

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
        const newOrders = await this.orders.findCreatedSinceWithStatuses(since, [
          'awaiting_approval',
        ]);
        if (newOrders.length === 0) {
          this.logger.debug(
            `No new orders awaiting approval for admin ${admin.id} since ${since.toISOString()}.`,
          );
          await this.admins.updateLastNotified(admin.id, now);
          continue;
        }

        for (const o of newOrders) {
          const message = this.formatSingleOrderDigest(o);
          try {
            await this.bot.telegram.sendMessage(admin.telegramId, message, {
              parse_mode: 'HTML',
              ...orderApprovalInlineKeyboard(o.id),
            });
          } catch (err) {
            const e = err as Error;
            this.logger.error(
              `Failed to send digest for order #${o.id} to admin ${admin.id}: ${e.message}`,
            );
          }
        }

        await this.admins.updateLastNotified(admin.id, now);
        this.logger.log(
          `Sent ${newOrders.length} order(s) awaiting approval to admin ${admin.id}.`,
        );
      } catch (err) {
        const e = err as Error;
        this.logger.error(`Failed to notify admin ${admin.id}: ${e.message}`);
      }
    }
  }

  private formatNewOrderAlert(
    order: Awaited<ReturnType<OrdersService['findByIdWithReseller']>>,
  ): string {
    if (!order) return '';
    return this.formatSingleOrderDigest(order);
  }

  private formatSingleOrderDigest(order: Order): string {
    const r = (order as unknown as {
      reseller?: { fullName?: string | null; phoneNumber?: string | null };
    }).reseller;
    const name = this.escapeHtml(r?.fullName || 'unknown');
    const phone = this.escapeHtml(r?.phoneNumber || '');
    const title = this.escapeHtml((order.productTitle || '').slice(0, 60));
    const total = order.sellingEtb.toLocaleString('en-US');
    const priceBase =
      order.quantity > 1 && order.unitEtb
        ? `${order.unitEtb.toLocaleString('en-US')} × ${order.quantity} = ${total} ETB`
        : `${total} ETB`;
    const usdTail = this.formatUsdTail(order);
    const priceLine = usdTail ? `${priceBase} ${usdTail}` : priceBase;

    const variantParts: string[] = [];
    if (order.size) variantParts.push(order.size);
    if (order.color) variantParts.push(order.color);
    if (order.quantity > 1) variantParts.push(`×${order.quantity}`);
    const variant = variantParts.length
      ? this.escapeHtml(variantParts.join(' · '))
      : null;

    const lines = [
      `<b>🆕 New order awaiting approval #${order.id}</b>`,
      '',
      `<b>${title}</b> — ${priceLine}`,
      `Submitted: ${this.escapeHtml(formatGmtPlus3(order.createdAt))}`,
      `By: ${name}${phone ? ' (' + phone + ')' : ''}`,
    ];
    if (variant) lines.push(`Variant: ${variant}`);
    if (order.link) {
      lines.push(`<a href="${this.escapeHtml(order.link)}">View product</a>`);
    }
    return lines.join('\n');
  }

  private formatUsd(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return '$' + value.toFixed(2);
  }

  private formatUsdTail(order: {
    userUnitAed?: number | null;
    userUnitUsd: number | null;
    scrapedUnitUsd: number | null;
  }): string {
    if (order.userUnitAed != null) {
      return `(${order.userUnitAed.toFixed(2)} AED)`;
    }
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

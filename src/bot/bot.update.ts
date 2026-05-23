import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { AdminsService } from '../admins/admins.service';
import {
  AdminAuthStateService,
  PendingAction,
} from '../admins/admin-auth-state.service';
import {
  CalculatorService,
  resolveDynamicMarginPercent,
} from '../calculator/calculator.service';
import { CategoriesService } from '../categories/categories.service';
import { CategoryEditStateService } from '../categories/category-edit-state.service';
import { Category } from '../categories/category.entity';
import { formatGmtPlus3 } from '../common/date-format';
import { FileLoggerService } from '../common/logger.service';
import { AppConfig } from '../config/configuration';
import { HealthNotificationsService } from '../health/health-notifications.service';
import { HealthReportService } from '../health/health-report.service';
import { OrdersService } from '../orders/orders.service';
import { Order } from '../orders/order.entity';
import {
  OrderDraft,
  OrderDraftStateService,
} from '../orders/order-draft-state.service';
import { ResellersService } from '../resellers/resellers.service';
import { LinkResolverService } from '../scraper/link-resolver.service';
import {
  DEFAULT_CLOTHING_SIZES,
  extractFreeText,
  extractSlugTitle,
  isClothingTitle,
} from '../scraper/manual-order.utils';
import { ScraperService } from '../scraper/scraper.service';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly resellers: ResellersService,
    private readonly orders: OrdersService,
    private readonly orderDraft: OrderDraftStateService,
    private readonly admins: AdminsService,
    private readonly adminAuth: AdminAuthStateService,
    private readonly scraper: ScraperService,
    private readonly linkResolver: LinkResolverService,
    private readonly calculator: CalculatorService,
    private readonly settings: SettingsService,
    private readonly categories: CategoriesService,
    private readonly categoryEditState: CategoryEditStateService,
    private readonly fileLogger: FileLoggerService,
    private readonly healthReport: HealthReportService,
    private readonly healthNotifications: HealthNotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private async ensureReseller(ctx: Context) {
    const from = ctx.from;
    if (!from) return null;
    return this.resellers.findOrCreateFromTelegram({
      id: from.id,
      username: from.username,
    });
  }

  private askForName(ctx: Context) {
    return ctx.reply(
      'Welcome to Medaf SHEIN orders.\n\n' +
        'Before placing your first order, please complete a quick registration.\n\n' +
        'What is your full name?',
      Markup.removeKeyboard(),
    );
  }

  private askForPhone(ctx: Context) {
    return ctx.reply(
      'Thank you. Please share your phone number using the button below to finish registration.',
      Markup.keyboard([Markup.button.contactRequest('📱 Share my phone number')])
        .oneTime()
        .resize(),
    );
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (from) this.adminAuth.clearPending(from.id);
    const reseller = await this.ensureReseller(ctx);
    if (!reseller) return;
    if (reseller.isRegistered()) {
      await ctx.reply(
        'Welcome to Medaf SHEIN orders.\nSend a SHEIN product link to place your order.',
        Markup.removeKeyboard(),
      );
      return;
    }
    if (!reseller.fullName) {
      await this.askForName(ctx);
    } else if (!reseller.phoneNumber) {
      await this.askForPhone(ctx);
    } else {
      await ctx.reply(
        'Welcome to Medaf SHEIN orders.\nSend a SHEIN product link to place your order.',
      );
    }
  }

  @Command('admin')
  async onAdminCommand(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    if (await this.admins.isAdmin(from.id)) {
      await this.sendAdminMenu(ctx);
      return;
    }

    const password = this.config.get('adminPassword', { infer: true });
    if (!password) {
      await ctx.reply('Admin access is not configured on this bot.');
      return;
    }

    this.adminAuth.setPending(from.id, 'admin-grant');
    await ctx.reply('🔐 Admin access\n\nEnter the admin password:');
  }

  @Command('notadmin')
  async onNotAdminCommand(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    this.adminAuth.clearPending(from.id);

    const isAdmin = await this.admins.isAdmin(from.id);
    if (!isAdmin) {
      await ctx.reply('You are not an admin.');
      return;
    }

    const removed = await this.admins.deleteByTelegramId(from.id);
    if (removed) {
      this.logger.log(`Admin revoked: telegramId=${from.id}`);
      await ctx.reply('✅ Your admin access has been revoked.');
    } else {
      await ctx.reply('You were not in the admin list.');
    }
  }

  @On('contact')
  async onContact(@Ctx() ctx: Context) {
    const from = ctx.from;
    const message = ctx.message as { contact?: { phone_number?: string; user_id?: number } } | undefined;
    if (!from || !message?.contact) return;

    if (message.contact.user_id && message.contact.user_id !== from.id) {
      await ctx.reply('Please share your own phone number, not someone else\u2019s.');
      return;
    }

    const reseller = await this.ensureReseller(ctx);
    if (!reseller) return;
    if (!reseller.fullName) {
      await this.askForName(ctx);
      return;
    }

    await this.resellers.setPhoneNumber(from.id, message.contact.phone_number || '');
    await ctx.reply(
      'Registration complete. Welcome to Medaf SHEIN orders — send a SHEIN product link to place your order.',
      Markup.removeKeyboard(),
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    const from = ctx.from;
    const message = ctx.message as { text?: string } | undefined;
    if (!from || !message?.text) return;
    const text = message.text.trim();

    const pending = this.adminAuth.getPending(from.id);
    if (pending) {
      await this.handlePendingAction(ctx, from.id, from.username, pending, text);
      return;
    }

    // Order-draft text routing. Each step that expects free-form text from
    // the user (custom quantity, unit USD price) is dispatched here before
    // any of the registration / SHEIN-link checks below.
    const activeDraft = this.orderDraft.getDraft(from.id);
    if (activeDraft && activeDraft.step === 'qty-input') {
      await this.handleOrderQuantityInput(ctx, from.id, text);
      return;
    }
    if (activeDraft && activeDraft.step === 'price') {
      await this.handleOrderPriceInput(ctx, from.id, activeDraft, text);
      return;
    }

    const reseller = await this.ensureReseller(ctx);
    if (!reseller) return;

    if (!reseller.fullName) {
      if (text.length < 2 || text.length > 80) {
        await ctx.reply('Please enter your full name (2-80 characters).');
        return;
      }
      await this.resellers.setFullName(from.id, text);
      await this.askForPhone(ctx);
      return;
    }

    if (!reseller.phoneNumber) {
      await this.askForPhone(ctx);
      return;
    }

    if (!/shein/i.test(text)) {
      await ctx.reply('Please send a valid SHEIN product link.');
      return;
    }

    const classification = this.linkResolver.classify(text);

    if (classification.kind === 'invalid') {
      await ctx.reply(classification.reason);
      return;
    }

    // Every valid SHEIN link routes through the manual flow. The scraping
    // providers (ScraperAPI, Retailed, SearchAPI) remain wired in the
    // codebase but are not invoked here while the manual flow proves
    // itself in production.
    const reason =
      classification.kind === 'manual' ? classification.reason : 'SHEIN product link';
    const productId =
      classification.kind === 'manual' ? classification.productId : null;
    this.logger.log(`Manual order flow for telegramId=${from.id}: ${reason}`);
    await this.startManualOrder(ctx, from.id, text, classification.url, productId);
  }

  /**
   * Starts an order draft for a SHEIN link where scraping is unreliable or
   * impossible (mobile m.shein.com URLs and SHEIN share links). The product
   * name is taken from the URL slug when available, otherwise from any free
   * text the user pasted around the link. The user supplies the USD price
   * themselves; shipping uses the best-matching category by product title.
   */
  private async startManualOrder(
    ctx: Context,
    userId: number,
    rawMessage: string,
    url: string,
    productId: string | null,
  ): Promise<void> {
    // Keep the same "Fetching..." message the scraping path used to send so
    // the user can't tell whether a real scrape happened. The small delay
    // below mimics network latency so the response feels natural.
    await ctx.reply('Fetching product details, please wait...');
    await this.simulateScrapeDelay();

    const freeText = extractFreeText(rawMessage);
    const slugTitle = extractSlugTitle(url);
    const productTitle =
      (freeText && freeText.length >= 4 ? freeText : null) ??
      slugTitle ??
      (productId ? `SHEIN product ${productId}` : 'SHEIN product');

    const sizes = isClothingTitle(productTitle) ? [...DEFAULT_CLOTHING_SIZES] : [];

    const category = await this.categories.findBestMatchByText(productTitle);
    const synthesized: ScrapedProduct = {
      title: productTitle,
      price: 0,
      priceRaw: null,
      priceUsd: null,
      priceUsdRaw: null,
      originalPrice: null,
      originalPriceRaw: null,
      onSale: false,
      currency: 'USD',
      inStock: true,
      image: null,
      productId,
      domain: this.safeHostname(url),
      source: 'manual',
      sizes,
      colors: [],
      breadcrumb: category ? [category.name] : [],
    };

    const totals = await this.calculator.calculateOrderTotalEtb(synthesized);

    // unitEtb/sellingEtb/totalEtb stay at 0 until the user enters the USD
    // price on the price step — the calculator will recompute them then.
    const draft = this.orderDraft.setDraft(userId, {
      productId,
      link: url,
      productTitle,
      sizes,
      colors: [],
      scrapedUnitUsd: null,
      unitEtb: 0,
      sellingEtb: 0,
      totalEtb: totals.deliveryEtb,
      deliveryEtb: totals.deliveryEtb,
      marginPercent: totals.marginPercent,
      rateUsed: totals.rateUsed,
      categoryName: category?.name ?? null,
    });

    this.logger.log(
      `Manual draft for telegramId=${userId} title="${productTitle.slice(0, 60)}" ` +
        `category="${category?.name ?? 'default'}" clothing=${sizes.length > 0}`,
    );

    await ctx.reply(this.buildDraftMessage(draft), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(draft),
    });
  }

  private safeHostname(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return 'shein.com';
    }
  }

  /**
   * Brief delay before showing the draft so the user does not notice that
   * the bot returned faster than a real scrape would. Tuned to feel close
   * to ScraperAPI's typical successful response time without being
   * annoying. Skipped during tests via NODE_ENV check.
   */
  private simulateScrapeDelay(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return Promise.resolve();
    const ms = 1200 + Math.floor(Math.random() * 600); // 1.2s–1.8s
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  @Action(/^ord:size:(\d+)$/)
  async onOrderPickSize(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const idx = parseInt(match?.[1] || '-1', 10);
    const size = draft.sizes[idx];
    if (!size) {
      await this.safeAnswer(ctx, 'Invalid size selection.', true);
      return;
    }
    const updated = this.orderDraft.selectSize(from.id, size);
    if (!updated) return;
    await this.safeAnswer(ctx, `Size: ${size}`, false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action(/^ord:color:(\d+)$/)
  async onOrderPickColor(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const idx = parseInt(match?.[1] || '-1', 10);
    const color = draft.colors[idx];
    if (!color) {
      await this.safeAnswer(ctx, 'Invalid color selection.', true);
      return;
    }
    const updated = this.orderDraft.selectColor(from.id, color);
    if (!updated) return;
    await this.safeAnswer(ctx, `Color: ${color}`, false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action(/^ord:qty:(\d+)$/)
  async onOrderPickQuantity(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const qty = parseInt(match?.[1] || '0', 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > 100) {
      await this.safeAnswer(ctx, 'Invalid quantity.', true);
      return;
    }
    const updated = this.orderDraft.selectQuantity(from.id, qty);
    if (!updated) return;
    await this.safeAnswer(ctx, `Quantity: ${qty}`, false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action('ord:qty:more')
  async onOrderQuantityMore(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    if (draft.step !== 'qty') {
      await this.safeAnswer(ctx, 'Not on the quantity step.', true);
      return;
    }
    const updated = this.orderDraft.enterQuantityInputMode(from.id);
    if (!updated) {
      await this.safeAnswer(ctx, 'Could not open custom quantity input.', true);
      return;
    }
    await this.safeAnswer(ctx, '', false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action('ord:qty:back')
  async onOrderQuantityBack(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    if (draft.step !== 'qty-input') {
      await this.safeAnswer(ctx, 'Not on the custom quantity step.', true);
      return;
    }
    const updated = this.orderDraft.exitQuantityInputMode(from.id);
    if (!updated) return;
    await this.safeAnswer(ctx, '', false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action('ord:price:keep')
  async onOrderPriceKeep(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }
    if (draft.step !== 'price') {
      await this.safeAnswer(ctx, 'Not on the price step.', true);
      return;
    }
    if (draft.scrapedUnitUsd == null) {
      await this.safeAnswer(
        ctx,
        'No scraped price to accept. Type the unit price in USD.',
        true,
      );
      return;
    }
    const updated = await this.applyUserPrice(from.id, draft, draft.scrapedUnitUsd);
    if (!updated) {
      await this.safeAnswer(
        ctx,
        'Pricing is not configured (USD→ETB missing). Please contact an admin.',
        true,
      );
      return;
    }
    await this.safeAnswer(ctx, 'Using scraped price.', false);
    await this.editDraftMessage(ctx, updated);
  }

  @Action('ord:cancel')
  async onOrderCancel(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    this.orderDraft.clearDraft(from.id);
    await this.safeAnswer(ctx, 'Order cancelled.', false);
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('orderDraftCancel', err);
    }
  }

  @Action('ord:confirm')
  async onOrderConfirm(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const draft = this.orderDraft.getDraft(from.id);
    if (!draft) {
      await this.safeAnswer(ctx, 'Order session expired. Send the link again.', true);
      return;
    }

    try {
      const reseller = await this.resellers.findByTelegramId(from.id);
      if (!reseller) {
        await this.safeAnswer(ctx, 'Please /start the bot to register first.', true);
        return;
      }
      if (!reseller.isRegistered()) {
        await this.safeAnswer(ctx, 'Please finish registration before placing an order.', true);
        return;
      }

      if (draft.step !== 'confirm') {
        await this.safeAnswer(
          ctx,
          'Please complete the unit price step before confirming.',
          true,
        );
        return;
      }

      const order = await this.orders.create({
        resellerId: reseller.id,
        productId: draft.productId,
        productTitle: draft.productTitle,
        link: draft.link,
        size: draft.selectedSize,
        color: draft.selectedColor,
        quantity: draft.quantity,
        unitEtb: draft.unitEtb,
        scrapedUnitUsd: draft.scrapedUnitUsd,
        userUnitUsd: draft.userUnitUsd,
        sellingEtb: draft.totalEtb,
      });

      this.orderDraft.clearDraft(from.id);

      this.logger.log(
        `Order #${order.id} placed by reseller ${reseller.id} (${reseller.fullName}) ` +
          `productId=${draft.productId} size=${draft.selectedSize ?? '-'} color=${draft.selectedColor ?? '-'} ` +
          `qty=${draft.quantity} unit=${draft.unitEtb} total=${draft.totalEtb} ` +
          `scrapedUsd=${draft.scrapedUnitUsd ?? '-'} userUsd=${draft.userUnitUsd ?? '-'}`,
      );

      const summary = this.buildDraftMessage(draft) + '\n\n⏳ Order placed — awaiting confirmation';
      try {
        await ctx.editMessageText(summary, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback('❌ Cancel order', `cancel:${order.id}`),
          ]),
        });
      } catch (err) {
        if (!this.isMessageNotModifiedError(err)) {
          this.fileLogger.logError('orderConfirmEdit', err);
        }
      }
      await this.safeAnswer(ctx, 'Order received! We will contact you shortly.', false);
    } catch (err) {
      this.fileLogger.logError('orderConfirm', err, { draft });
      await this.safeAnswer(ctx, 'Could not save your order. Please try again.', true);
    }
  }

  @Action(/^cancel:(\d+)$/)
  async onCancel(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const orderId = parseInt(match?.[1] || '0', 10);
    if (!orderId) {
      await this.safeAnswer(ctx, 'Invalid order.', true);
      return;
    }

    try {
      const order = await this.orders.findById(orderId);
      if (!order) {
        await this.safeAnswer(ctx, 'Order not found.', true);
        return;
      }

      const reseller = await this.resellers.findByTelegramId(from.id);
      if (!reseller || reseller.id !== order.resellerId) {
        await this.safeAnswer(ctx, 'You can only cancel your own orders.', true);
        return;
      }

      if (order.status === 'cancelled') {
        await this.replaceStatusAndRemoveButtons(ctx, '✗ Order cancelled');
        await this.safeAnswer(ctx, 'Order was already cancelled.', false);
        return;
      }

      await this.orders.cancel(orderId);
      this.logger.log(`Order #${orderId} cancelled by reseller ${reseller.id}`);

      await this.replaceStatusAndRemoveButtons(ctx, '✗ Order cancelled');
      await this.safeAnswer(ctx, 'Order cancelled.', false);
    } catch (err) {
      this.fileLogger.logError('cancel', err, { orderId });
      await this.safeAnswer(ctx, 'Could not cancel your order. Please try again.', true);
    }
  }

  @Action('admin:report')
  async onAdminReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Loading report...', false);
    try {
      const report = await this.orders.getReport();
      const from = ctx.from;
      await ctx.editMessageText(this.buildReportMessage(report), {
        parse_mode: 'HTML',
        ...this.adminMenuKeyboard(from?.id),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminReport', err);
    }
  }

  @Action('admin:health')
  async onAdminHealth(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    if (!this.healthReport.isHealthReportRecipient(from.id)) {
      await this.safeAnswer(ctx, 'Health reports are restricted.', true);
      return;
    }
    await this.safeAnswer(ctx, 'Generating health report…', false);
    try {
      const body = await this.healthReport.buildReportMessage();
      await ctx.reply(body, { parse_mode: 'HTML' });
    } catch (err) {
      this.fileLogger.logError('adminHealth', err);
      await ctx.reply('Could not generate the health report. Check server logs.');
    }
  }

  @Action('admin:settings')
  async onAdminSettings(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Loading settings...', false);
    try {
      const body = await this.buildSettingsMessage();
      await ctx.editMessageText(body, {
        parse_mode: 'HTML',
        ...(await this.buildSettingsKeyboard()),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminSettings', err);
    }
  }

  @Action('admin:edit:delivery')
  async onEditDelivery(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-delivery');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply('Enter new delivery fee (ETB), e.g. 500:');
  }

  @Action('admin:edit:rate')
  async onEditRate(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-rate');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply('Enter new USD → ETB rate, e.g. 165:');
  }

  @Action('admin:add')
  async onAddAdmin(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'add-admin');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply(
      'Send the Telegram user ID to grant admin access.\n' +
        '(They can find it by messaging @userinfobot)',
    );
  }

  @Action(/^admin:remove:(\d+)$/)
  async onRemoveAdmin(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;

    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const targetId = match?.[1];
    if (!targetId) {
      await this.safeAnswer(ctx, 'Invalid admin.', true);
      return;
    }

    if (String(from.id) === targetId) {
      await this.safeAnswer(
        ctx,
        'Use /notadmin to revoke your own access.',
        true,
      );
      return;
    }

    const removed = await this.admins.deleteByTelegramId(targetId);
    if (!removed) {
      await this.safeAnswer(ctx, 'Admin not found.', true);
      return;
    }

    this.logger.log(`Admin ${targetId} removed by telegramId=${from.id}`);
    await this.safeAnswer(ctx, `Admin ${targetId} removed.`, false);

    try {
      const body = await this.buildSettingsMessage();
      await ctx.editMessageText(body, {
        parse_mode: 'HTML',
        ...(await this.buildSettingsKeyboard()),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminRemove', err);
    }
  }

  @Action('admin:pending')
  async onAdminPending(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Loading pending orders...', false);
    try {
      const pending = await this.orders.findPending();
      await ctx.editMessageText(this.buildPendingMessage(pending), {
        parse_mode: 'HTML',
        ...this.pendingKeyboard(pending),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminPending', err);
    }
  }

  @Action(/^admin:done:(\d+)$/)
  async onAdminMarkDone(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const orderId = parseInt(match?.[1] || '0', 10);
    if (!orderId) {
      await this.safeAnswer(ctx, 'Invalid order.', true);
      return;
    }

    try {
      const order = await this.orders.findById(orderId);
      if (!order) {
        await this.safeAnswer(ctx, 'Order not found.', true);
        return;
      }
      if (order.status === 'cancelled') {
        await this.safeAnswer(ctx, 'That order was cancelled and cannot be marked done.', true);
        return;
      }
      if (order.status === 'completed') {
        await this.safeAnswer(ctx, `Order #${orderId} was already marked done.`, false);
      } else {
        await this.orders.markCompleted(orderId);
        const from = ctx.from;
        this.logger.log(
          `Order #${orderId} marked completed by admin telegramId=${from?.id}`,
        );
        await this.safeAnswer(ctx, `✓ Order #${orderId} marked done.`, false);
      }

      const pending = await this.orders.findPending();
      try {
        await ctx.editMessageText(this.buildPendingMessage(pending), {
          parse_mode: 'HTML',
          ...this.pendingKeyboard(pending),
        });
      } catch (err) {
        if (this.isMessageNotModifiedError(err)) return;
        throw err;
      }
    } catch (err) {
      this.fileLogger.logError('adminMarkDone', err, { orderId });
      await this.safeAnswer(ctx, 'Could not mark order done. Please try again.', true);
    }
  }

  @Action('admin:categories')
  async onAdminCategories(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (from) {
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
      this.categoryEditState.clearPendingNewCategory(from.id);
    }
    await this.safeAnswer(ctx, 'Loading categories...', false);
    try {
      const list = await this.categories.findAll();
      await ctx.editMessageText(this.buildCategoriesMessage(list), {
        parse_mode: 'HTML',
        ...this.categoriesKeyboard(list),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategories', err);
      const message = (err as Error)?.message || 'unknown error';
      try {
        await ctx.reply(
          `Could not load categories.\n<code>${this.escapeHtml(message).slice(0, 300)}</code>`,
          { parse_mode: 'HTML' },
        );
      } catch (replyErr) {
        this.fileLogger.logError('adminCategoriesReply', replyErr);
      }
    }
  }

  /**
   * Single entry point for every callback whose data starts with `admin:cat:`.
   * Dispatches internally based on the suffix so we cannot accidentally
   * shadow one regex Action with another. The suffix grammar is:
   *   add                       -> open "Add category" wizard
   *   cancel                    -> exit current edit/add and return to list
   *   <id>                      -> open detail panel for category
   *   fee:<id>                  -> prompt to edit shipping fee
   *   comm:<id>                 -> prompt to edit commission
   *   clear-fee:<id>            -> set shipping fee to null
   *   clear-comm:<id>           -> set commission to null
   *   clear-both:<id>           -> set both columns to null
   */
  @Action(/^admin:cat:(.+)$/)
  async onAdminCategoryAction(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const suffix = match?.[1] || '';
    this.logger.log(`admin:cat callback userId=${from.id} suffix=${suffix}`);

    if (suffix === 'add') {
      this.adminAuth.setPending(from.id, 'add-category');
      await this.safeAnswer(ctx, '', false);
      await ctx.reply(
        'Enter the new category name (1–80 characters).\nSend <code>cancel</code> to abort.',
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (suffix === 'cancel') {
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
      this.categoryEditState.clearPendingNewCategory(from.id);
      await this.safeAnswer(ctx, 'Cancelled.', false);
      await this.showCategoriesList(ctx);
      return;
    }

    const clearMatch = suffix.match(/^clear-(fee|comm|both):(\d+)$/);
    if (clearMatch) {
      const field = clearMatch[1] as 'fee' | 'comm' | 'both';
      const categoryId = parseInt(clearMatch[2], 10);
      await this.handleCategoryClear(ctx, from.id, field, categoryId);
      return;
    }

    const fieldMatch = suffix.match(/^(fee|comm):(\d+)$/);
    if (fieldMatch) {
      const field = fieldMatch[1] === 'comm' ? 'commission' : 'shipping fee';
      const categoryId = parseInt(fieldMatch[2], 10);
      await this.handleCategoryEditFieldPrompt(ctx, from.id, field, categoryId);
      return;
    }

    if (/^\d+$/.test(suffix)) {
      const categoryId = parseInt(suffix, 10);
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
      await this.safeAnswer(ctx, '', false);
      await this.showCategoryDetail(ctx, categoryId, 'edit');
      return;
    }

    this.logger.warn(`Unknown admin:cat suffix received: ${suffix}`);
    await this.safeAnswer(ctx, 'Unknown category action.', true);
  }

  private async showCategoriesList(ctx: Context): Promise<void> {
    try {
      const list = await this.categories.findAll();
      await ctx.editMessageText(this.buildCategoriesMessage(list), {
        parse_mode: 'HTML',
        ...this.categoriesKeyboard(list),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('showCategoriesList', err);
    }
  }

  private async handleCategoryEditFieldPrompt(
    ctx: Context,
    userId: number,
    field: 'commission' | 'shipping fee',
    categoryId: number,
  ): Promise<void> {
    if (!categoryId) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }
    const category = await this.categories.findById(categoryId);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(
      userId,
      field === 'commission' ? 'edit-category-commission' : 'edit-category-fee',
    );
    this.categoryEditState.setPending(userId, categoryId);
    await this.safeAnswer(ctx, '', false);

    const current =
      field === 'commission' ? category.commissionEtb : category.shippingCost;
    const body =
      `<b>✏️ ${this.escapeHtml(category.name)} — ${field}</b>\n\n` +
      `Current: <b>${this.formatCategoryEtb(current)}</b>\n\n` +
      'Send the new amount in ETB (example: <code>600</code>).\n' +
      'Send <code>clear</code> to remove this value, or <code>cancel</code> to return.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('← Back', `admin:cat:${category.id}`)],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEditField', err, { categoryId, field });
    }
  }

  private async handleCategoryClear(
    ctx: Context,
    userId: number,
    field: 'fee' | 'comm' | 'both',
    categoryId: number,
  ): Promise<void> {
    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPending(userId);
    if (!categoryId) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }
    try {
      const updated =
        field === 'fee'
          ? await this.categories.setShippingCost(categoryId, null)
          : field === 'comm'
            ? await this.categories.setCommissionEtb(categoryId, null)
            : await this.categories.clearCosts(categoryId);
      if (!updated) {
        await this.safeAnswer(ctx, 'Category not found.', true);
        return;
      }
      const label =
        field === 'fee' ? 'shipping fee' : field === 'comm' ? 'commission' : 'costs';
      await this.safeAnswer(ctx, `Cleared ${label} for ${updated.name}.`, false);
      await this.showCategoryDetail(ctx, categoryId, 'edit');
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryClear', err, { categoryId, field });
    }
  }

  @Action('admin:menu')
  async onAdminMenu(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Menu', false);
    try {
      const from = ctx.from;
      await ctx.editMessageText(this.buildAdminMenuText(from?.id), {
        parse_mode: 'HTML',
        ...this.adminMenuKeyboard(from?.id),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminMenu', err);
    }
  }

  @Action('admin:close')
  async onAdminClose(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    try {
      await ctx.deleteMessage();
    } catch {
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch (err) {
        this.fileLogger.logError('adminClose', err);
      }
    }
    await this.safeAnswer(ctx, 'Panel closed.', false);
  }

  private async handlePendingAction(
    ctx: Context,
    userId: number,
    username: string | undefined,
    action: PendingAction,
    text: string,
  ): Promise<void> {
    switch (action) {
      case 'admin-grant':
        await this.handleAdminGrant(ctx, userId, username, text);
        break;
      case 'edit-delivery':
        await this.handleSettingValue(ctx, userId, SETTING_KEYS.DELIVERY_ETB, text, {
          min: 0,
          max: 1_000_000,
          label: 'Delivery fee',
          suffix: ' ETB',
        });
        break;
      case 'edit-rate':
        await this.handleSettingValue(ctx, userId, SETTING_KEYS.USD_TO_ETB, text, {
          min: 1,
          max: 10_000,
          label: 'USD → ETB rate',
          suffix: '',
        });
        break;
      case 'add-admin':
        await this.handleAddAdmin(ctx, userId, text);
        break;
      case 'edit-category-cost':
      case 'edit-category-fee':
        await this.handleEditCategoryAmount(ctx, userId, text, 'fee');
        break;
      case 'edit-category-commission':
        await this.handleEditCategoryAmount(ctx, userId, text, 'commission');
        break;
      case 'add-category':
        await this.handleAddCategory(ctx, userId, text);
        break;
      case 'add-category-cost':
      case 'add-category-fee':
        await this.handleAddCategoryFee(ctx, userId, text);
        break;
      case 'add-category-commission':
        await this.handleAddCategoryCommission(ctx, userId, text);
        break;
    }
  }

  private async handleAddCategory(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const normalized = text.trim();
    if (normalized.toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Add category cancelled.');
      return;
    }

    if (normalized.length < 1 || normalized.length > 80) {
      await ctx.reply('Invalid name. Enter 1–80 characters, or send "cancel".');
      return;
    }

    const existing = await this.categories.findByName(normalized);
    if (existing) {
      await ctx.reply(
        `A category named <b>${this.escapeHtml(normalized)}</b> already exists. ` +
          'Send a different name, or "cancel".',
        { parse_mode: 'HTML' },
      );
      return;
    }

    this.categoryEditState.setPendingNewName(userId, normalized);
    this.adminAuth.setPending(userId, 'add-category-fee');
    await ctx.reply(
      `Now enter the shipping fee (ETB) for <b>${this.escapeHtml(normalized)}</b>.\n` +
        'Send <code>skip</code> to leave it unset, or <code>cancel</code> to abort.',
      { parse_mode: 'HTML' },
    );
  }

  private async handleAddCategoryFee(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const name = this.categoryEditState.getPendingNewName(userId);
    if (!name) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Add session expired. Open Categories again.');
      return;
    }

    const parsed = this.parseCategoryAmount(text, true);
    if (parsed.kind === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Add category cancelled.');
      return;
    }
    if (parsed.kind === 'error') {
      await ctx.reply(parsed.message);
      return;
    }

    this.categoryEditState.setPendingNewFee(userId, parsed.value);
    this.adminAuth.setPending(userId, 'add-category-commission');
    await ctx.reply(
      `Now enter the commission (ETB) for <b>${this.escapeHtml(name)}</b>.\n` +
        'Send <code>skip</code> to leave it unset, or <code>cancel</code> to abort.',
      { parse_mode: 'HTML' },
    );
  }

  private async handleAddCategoryCommission(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const name = this.categoryEditState.getPendingNewName(userId);
    const fee = this.categoryEditState.getPendingNewFee(userId);
    if (!name || fee === undefined) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Add session expired. Open Categories again.');
      return;
    }

    const parsed = this.parseCategoryAmount(text, true);
    if (parsed.kind === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Add category cancelled.');
      return;
    }
    if (parsed.kind === 'error') {
      await ctx.reply(parsed.message);
      return;
    }

    const result = await this.categories.create(name, fee, parsed.value);
    if (result.error === 'invalid') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply('Stored name became invalid. Start again from the Categories list.');
      return;
    }
    if (result.error === 'duplicate') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewCategory(userId);
      await ctx.reply(
        `<b>${this.escapeHtml(name)}</b> was created elsewhere in the meantime. Try again.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPendingNewCategory(userId);

    const created = result.category!;
    this.logger.log(
      `Category created: ${created.name} (#${created.id}) by admin ${userId}`,
    );
    await ctx.reply(
      `✅ Category <b>${this.escapeHtml(created.name)}</b> created.\n` +
        `Delivery total: <b>${this.formatCategoryEtb(this.categoryDeliveryTotal(created))}</b>`,
      { parse_mode: 'HTML' },
    );

    const list = await this.categories.findAll();
    await ctx.reply(this.buildCategoriesMessage(list), {
      parse_mode: 'HTML',
      ...this.categoriesKeyboard(list),
    });
  }

  /**
   * Parses a custom-quantity reply typed by the user after they tapped
   * "➕ More" on the quantity keyboard. On success the draft advances to the
   * price step using the existing `selectQuantity` transition, so the rest
   * of the flow behaves identically to a tapped 1-5 button.
   */
  private async handleOrderQuantityInput(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.toLowerCase() === 'cancel') {
      this.orderDraft.clearDraft(userId);
      await ctx.reply('Order cancelled.');
      return;
    }
    if (trimmed.toLowerCase() === 'back') {
      const reverted = this.orderDraft.exitQuantityInputMode(userId);
      if (!reverted) {
        await ctx.reply('Order session expired. Send the link again.');
        return;
      }
      await ctx.reply(this.buildDraftMessage(reverted), {
        parse_mode: 'HTML',
        ...this.buildDraftKeyboard(reverted),
      });
      return;
    }
    // Accept "3", " 3 ", "3 pcs", etc. Reject decimals/negatives by requiring
    // the entire trimmed input to parse as a positive integer once stripped
    // of non-digits at the edges.
    const cleaned = trimmed.replace(/[^\d]/g, '');
    if (!cleaned || cleaned !== trimmed.match(/\d+/)?.[0]) {
      await ctx.reply(
        'That does not look like a whole number. Send a quantity like ' +
          '<code>7</code> (between 1 and 100), or tap "← Back" / "✗ Cancel".',
        { parse_mode: 'HTML' },
      );
      return;
    }
    const qty = parseInt(cleaned, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > 100) {
      await ctx.reply('Quantity must be a whole number between 1 and 100.');
      return;
    }
    const updated = this.orderDraft.selectQuantity(userId, qty);
    if (!updated) {
      await ctx.reply('Order session expired. Send the link again.');
      return;
    }
    await ctx.reply(this.buildDraftMessage(updated), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(updated),
    });
  }

  private async handleOrderPriceInput(
    ctx: Context,
    userId: number,
    draft: OrderDraft,
    text: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.toLowerCase() === 'cancel') {
      this.orderDraft.clearDraft(userId);
      await ctx.reply('Order cancelled.');
      return;
    }

    const parsed = this.parseUsdInput(trimmed);
    if (parsed == null) {
      await ctx.reply(
        'That does not look like a price. Send a number like <code>8.09</code>, ' +
          'tap "Use scraped", or send <code>cancel</code>.',
        { parse_mode: 'HTML' },
      );
      return;
    }
    if (parsed <= 0 || parsed > 100_000) {
      await ctx.reply('Price must be between 0.01 and 100,000 USD.');
      return;
    }

    const updated = await this.applyUserPrice(userId, draft, parsed);
    if (!updated) {
      // Two failure modes converge here: the draft may have expired (rare —
      // we just fetched it 0 ms ago) or the `usd_to_etb` settings row is
      // missing/invalid. The latter is the more common operational issue, so
      // the message names it explicitly.
      await ctx.reply(
        'Could not price this order — USD→ETB rate is not configured. ' +
          'An admin needs to set it under Settings → USD→ETB.',
      );
      return;
    }

    await ctx.reply(this.buildDraftMessage(updated), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(updated),
    });
  }

  /**
   * Recomputes ETB amounts from the snapshot fields stored on the draft and
   * transitions it to the confirm step. Uses the same math as
   * CalculatorService so the user sees consistent totals.
   */
  private async applyUserPrice(
    userId: number,
    draft: OrderDraft,
    userUnitUsd: number,
  ): Promise<OrderDraft | null> {
    // Authoritative USD→ETB rate comes from the `settings` table row whose
    // key is `usd_to_etb` (SETTING_KEYS.USD_TO_ETB). Reading it live here
    // — rather than reusing the draft's snapshot from creation time — means
    // an admin who edits the rate in the middle of a reseller's draft sees
    // their change applied to the very next price entry. The draft snapshot
    // is only used as a safety fallback in the unlikely case the row was
    // wiped between draft creation (when CalculatorService validated it)
    // and now.
    const dbRate = await this.settings.getNumber(SETTING_KEYS.USD_TO_ETB, 0);
    const rate = dbRate > 0 ? dbRate : draft.rateUsed;
    if (!rate || rate <= 0) {
      this.fileLogger.logError(
        'applyUserPrice',
        new Error('USD_TO_ETB is not configured in settings'),
        { userId },
      );
      return null;
    }

    // Pricing math (must match CalculatorService.calculateOrderTotalEtb):
    //   1) baseEtb     = USD × rate
    //   2) subtotal    = baseEtb + delivery        (delivery folded in first)
    //   3) margin tier picked from subtotal
    //   4) itemEtb     = subtotal × (1 + margin/100)  (margin applies to delivery too)
    //   5) total       = ceil(itemEtb × qty)          (always round up)
    const baseEtbPerUnit = userUnitUsd * rate;
    const subtotalPerUnit = baseEtbPerUnit + draft.deliveryEtb;
    const margin = resolveDynamicMarginPercent(subtotalPerUnit);
    const itemEtbPerUnit = subtotalPerUnit * (1 + margin / 100);
    const total = Math.ceil(itemEtbPerUnit * draft.quantity);

    const sellingPerUnit = Math.ceil(itemEtbPerUnit);
    const sellingTotal = total;

    return this.orderDraft.setUserPrice(userId, {
      userUnitUsd,
      unitEtb: sellingPerUnit,
      sellingEtb: sellingTotal,
      totalEtb: total,
      marginPercent: margin,
      rateUsed: rate,
    });
  }

  private parseUsdInput(raw: string): number | null {
    // Accept "$8.09", "8.09", "8,09" (European decimal). Reject things with
    // letters or multiple separators.
    const cleaned = raw.replace(/[$\s]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  private async handleEditCategoryAmount(
    ctx: Context,
    userId: number,
    text: string,
    field: 'fee' | 'commission',
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const categoryId = this.categoryEditState.getPending(userId);
    if (!categoryId) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Edit session expired. Open the category list again.');
      return;
    }

    const parsed = this.parseCategoryAmount(text, false);
    if (parsed.kind === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPending(userId);
      await this.showCategoryDetail(ctx, categoryId, 'reply');
      return;
    }
    if (parsed.kind === 'error') {
      await ctx.reply(parsed.message);
      return;
    }

    const updated =
      field === 'fee'
        ? await this.categories.setShippingCost(categoryId, parsed.value)
        : await this.categories.setCommissionEtb(categoryId, parsed.value);
    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPending(userId);

    if (!updated) {
      await ctx.reply('Category not found.');
      return;
    }

    const label = field === 'fee' ? 'shipping fee' : 'commission';
    const formatted =
      (field === 'fee' ? updated.shippingCost : updated.commissionEtb) == null
        ? 'cleared'
        : this.formatCategoryEtb(
            field === 'fee' ? updated.shippingCost : updated.commissionEtb,
          );
    this.logger.log(
      `Category #${categoryId} (${updated.name}) ${label} ${formatted} by admin ${userId}`,
    );
    await ctx.reply(
      `✅ <b>${this.escapeHtml(updated.name)}</b> ${label} ${formatted}.`,
      { parse_mode: 'HTML' },
    );

    await this.showCategoryDetail(ctx, categoryId, 'reply');
  }

  private async handleAdminGrant(
    ctx: Context,
    userId: number,
    username: string | undefined,
    text: string,
  ): Promise<void> {
    const expected = this.config.get('adminPassword', { infer: true });
    if (!expected) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access is not configured on this bot.');
      return;
    }

    if (text !== expected) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('❌ Wrong password. Send /admin to try again.');
      return;
    }

    await this.admins.grant(userId, username ?? null);
    this.adminAuth.clearPending(userId);
    this.logger.log(`Admin granted to telegramId=${userId}`);
    await ctx.reply('✅ Admin access granted.');
    await this.sendAdminMenu(ctx);
  }

  private async handleSettingValue(
    ctx: Context,
    userId: number,
    key: string,
    text: string,
    opts: { min: number; max: number; label: string; suffix: string },
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const value = parseFloat(text.replace(/,/g, ''));
    if (!Number.isFinite(value) || value < opts.min || value > opts.max) {
      await ctx.reply(
        `Invalid value. Enter a number between ${opts.min} and ${opts.max}.`,
      );
      return;
    }

    await this.settings.set(key, String(value));
    this.adminAuth.clearPending(userId);
    this.logger.log(`Setting ${key} updated to ${value} by admin ${userId}`);
    await ctx.reply(`✅ ${opts.label} updated to ${value}${opts.suffix}.`);
    await ctx.reply(await this.buildSettingsMessage(), {
      parse_mode: 'HTML',
      ...(await this.buildSettingsKeyboard()),
    });
  }

  private async handleAddAdmin(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const targetId = text.replace(/\D/g, '');
    if (!targetId || !/^\d+$/.test(targetId)) {
      await ctx.reply('Invalid Telegram ID. Send numbers only, e.g. 1041346091');
      return;
    }

    if (String(userId) === targetId) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('You are already an admin.');
      return;
    }

    await this.admins.grant(targetId, null);
    this.adminAuth.clearPending(userId);
    this.logger.log(`Admin ${targetId} added by telegramId=${userId}`);
    await ctx.reply(`✅ Admin access granted to user ${targetId}.`);
    await ctx.reply(await this.buildSettingsMessage(), {
      parse_mode: 'HTML',
      ...(await this.buildSettingsKeyboard()),
    });
  }

  private async sendAdminMenu(ctx: Context): Promise<void> {
    const from = ctx.from;
    await ctx.reply(this.buildAdminMenuText(from?.id), {
      parse_mode: 'HTML',
      ...this.adminMenuKeyboard(from?.id),
    });
  }

  private adminMenuKeyboard(telegramId?: number) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [
        Markup.button.callback('📊 Report', 'admin:report'),
        Markup.button.callback('📦 Pending', 'admin:pending'),
      ],
    ];
    if (telegramId != null && this.healthReport.isHealthReportRecipient(telegramId)) {
      rows.push([Markup.button.callback('🩺 Health Report', 'admin:health')]);
    }
    rows.push([Markup.button.callback('⚙️ Settings', 'admin:settings')]);
    rows.push([Markup.button.callback('✕ Close', 'admin:close')]);
    return Markup.inlineKeyboard(rows);
  }

  private buildAdminMenuText(telegramId?: number): string {
    const lines = [
      '<b>🔐 Admin panel</b>',
      '',
      'Choose an option:',
      '• <b>Report</b> — order stats and recent orders',
      '• <b>Pending</b> — mark pending orders as delivered',
      '• <b>Settings</b> — bot config and admin list',
    ];
    if (telegramId != null && this.healthReport.isHealthReportRecipient(telegramId)) {
      lines.splice(4, 0, '• <b>Health Report</b> — uptime, memory, critical errors');
    }
    lines.push('', '<i>You receive new-order digests every 6 hours.</i>');
    return lines.join('\n');
  }

  private buildReportMessage(
    report: Awaited<ReturnType<OrdersService['getReport']>>,
  ): string {
    const total = report.pending + report.cancelled + report.completed;
    const lines = [
      '<b>📊 Orders report</b>',
      '',
      `<b>Total orders:</b> ${total}`,
      `⏳ Pending: <b>${report.pending}</b>   ✗ Cancelled: <b>${report.cancelled}</b>   ✓ Completed: <b>${report.completed}</b>`,
      `💰 Revenue (non-cancelled): <b>${report.totalRevenueEtb.toLocaleString('en-US')} ETB</b>`,
      `🕐 Last 24h: <b>${report.last24hCount}</b> order(s)`,
      '',
      `<b>Recent orders</b> (showing ${report.recent.length})`,
    ];

    if (report.recent.length === 0) {
      lines.push('', '<i>No orders yet.</i>');
      return lines.join('\n');
    }

    report.recent.forEach((o, idx) => {
      const r = (o as unknown as {
        reseller?: { fullName?: string | null; phoneNumber?: string | null };
      }).reseller;
      const name = this.escapeHtml(r?.fullName || 'unknown');
      const phone = this.escapeHtml(this.formatPhone(r?.phoneNumber));
      const status = this.formatStatus(o.status);
      const title = this.escapeHtml((o.productTitle || '').slice(0, 60));
      lines.push('');
      lines.push(`<b>Order ${idx + 1}</b>`);
      lines.push(`  ID:      #${o.id}`);
      lines.push(`  Placed:  ${this.escapeHtml(formatGmtPlus3(o.createdAt))}`);
      lines.push(`  Product: ${title}`);
      const variant = this.formatOrderVariant(o);
      if (variant) lines.push(`  Variant: ${this.escapeHtml(variant)}`);
      lines.push(`  Price:   ${this.formatOrderPrice(o)}`);
      lines.push(`  Name:    ${name}`);
      lines.push(`  Phone:   ${phone}`);
      lines.push(`  Status:  ${status}`);
      const link = this.formatOrderLink(o);
      if (link) lines.push(`  Link:    ${link}`);
    });

    return lines.join('\n');
  }

  private buildPendingMessage(
    pending: Awaited<ReturnType<OrdersService['findPending']>>,
  ): string {
    const lines = [
      '<b>📦 Pending orders</b>',
      '',
      `Total pending: <b>${pending.length}</b>`,
    ];

    if (pending.length === 0) {
      lines.push('', '<i>No pending orders. All caught up.</i>');
      return lines.join('\n');
    }

    pending.forEach((o, idx) => {
      const r = (o as unknown as {
        reseller?: { fullName?: string | null; phoneNumber?: string | null };
      }).reseller;
      const name = this.escapeHtml(r?.fullName || 'unknown');
      const phone = this.escapeHtml(this.formatPhone(r?.phoneNumber));
      const title = this.escapeHtml((o.productTitle || '').slice(0, 60));
      lines.push('');
      lines.push(`<b>Order ${idx + 1}</b>`);
      lines.push(`  ID:      #${o.id}`);
      lines.push(`  Placed:  ${this.escapeHtml(formatGmtPlus3(o.createdAt))}`);
      lines.push(`  Product: ${title}`);
      const variant = this.formatOrderVariant(o);
      if (variant) lines.push(`  Variant: ${this.escapeHtml(variant)}`);
      lines.push(`  Price:   ${this.formatOrderPrice(o)}`);
      lines.push(`  Name:    ${name}`);
      lines.push(`  Phone:   ${phone}`);
      const link = this.formatOrderLink(o);
      if (link) lines.push(`  Link:    ${link}`);
    });

    lines.push('', '<i>Tap a button below to mark an order as delivered.</i>');
    return lines.join('\n');
  }

  private pendingKeyboard(
    pending: Awaited<ReturnType<OrdersService['findPending']>>,
  ) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = pending.map((o) => [
      Markup.button.callback(`✓ Mark #${o.id} done`, `admin:done:${o.id}`),
    ]);
    rows.push([
      Markup.button.callback('📊 Report', 'admin:report'),
      Markup.button.callback('⚙️ Settings', 'admin:settings'),
    ]);
    rows.push([Markup.button.callback('← Back to menu', 'admin:menu')]);
    return Markup.inlineKeyboard(rows);
  }

  private formatOrderVariant(order: Order): string | null {
    const parts: string[] = [];
    if (order.size) parts.push(order.size);
    if (order.color) parts.push(order.color);
    if (order.quantity > 1) parts.push(`×${order.quantity}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private formatOrderPrice(order: Order): string {
    const total = order.sellingEtb.toLocaleString('en-US') + ' ETB';
    const main =
      order.quantity > 1 && order.unitEtb
        ? `${order.unitEtb.toLocaleString('en-US')} × ${order.quantity} = ${total}`
        : total;
    const usdTail = this.formatUsdTail(order);
    return usdTail ? `${main} ${usdTail}` : main;
  }

  /**
   * Returns "($8.09 USD)" or "($8.09 USD, scraped $32.36)" depending on
   * whether the user overrode the scraped price. Empty when no USD values
   * are recorded.
   */
  private formatUsdTail(order: Order): string {
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

  private formatOrderLink(order: Order): string | null {
    if (!order.link) return null;
    const safeUrl = this.escapeHtml(order.link);
    return `<a href="${safeUrl}">View product</a>`;
  }

  private formatStatus(status: string): string {
    if (status === 'pending') return '⏳ Pending';
    if (status === 'cancelled') return '✗ Cancelled';
    if (status === 'completed') return '✓ Completed';
    return status;
  }

  private formatPhone(raw: string | null | undefined): string {
    if (!raw) return '—';
    const trimmed = raw.trim();
    if (!trimmed) return '—';
    const digits = trimmed.replace(/[^\d]/g, '');
    if (!digits) return trimmed;
    const normalized = this.normalizePhoneDigits(digits);
    if (/^251\d{9}$/.test(normalized)) {
      const local = normalized.slice(3);
      return `+251 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
    }
    return '+' + normalized;
  }

  private normalizePhoneDigits(digits: string): string {
    if (digits.startsWith('0') && digits.length === 10) return '251' + digits.slice(1);
    return digits;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async buildSettingsMessage(): Promise<string> {
    const pricing = this.config.get('pricing', { infer: true });
    const delivery = await this.settings.getNumber(
      SETTING_KEYS.DELIVERY_ETB,
      pricing.deliveryCostEtb,
    );
    const usd = await this.settings.getNumber(SETTING_KEYS.USD_TO_ETB, pricing.usdToEtb ?? 0);
    const adminList = await this.admins.findAll();

    const lines = [
      '<b>⚙️ Settings</b>',
      '',
      '<b>Pricing</b> (tap a button to edit)',
      '• Profit margin (dynamic; tier picked from per-unit subtotal ETB incl. delivery, then applied to that whole subtotal):',
      '   – &lt; 3,000 ETB → <b>30%</b>',
      '   – 3,000–10,000 ETB → <b>20%</b>',
      '   – &gt; 10,000 ETB → <b>15%</b>',
      '• Totals are rounded <b>up</b> after multiplying by quantity.',
      `• Default delivery fallback: <b>${delivery.toLocaleString('en-US')} ETB</b>`,
      '• Category delivery: shipping fee + commission, used when a category matches',
      `• USD → ETB: <b>${usd > 0 ? usd : 'not set'}</b>`,
      '',
      `<b>Admins</b> (${adminList.length})`,
    ];

    if (adminList.length === 0) {
      lines.push('<i>No admins yet.</i>');
    } else {
      for (const a of adminList) {
        const uname = a.telegramUsername ? `@${a.telegramUsername}` : 'no username';
        lines.push(`• <code>${a.telegramId}</code> ${uname}`);
      }
    }

    lines.push('', '<i>Revoke your own access: /notadmin</i>');
    return lines.join('\n');
  }

  private async buildSettingsKeyboard() {
    const adminList = await this.admins.findAll();
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [
        Markup.button.callback('✏️ Fallback delivery', 'admin:edit:delivery'),
        Markup.button.callback('✏️ USD→ETB', 'admin:edit:rate'),
      ],
      [Markup.button.callback('📂 Categories', 'admin:categories')],
      [Markup.button.callback('➕ Add admin', 'admin:add')],
    ];

    for (const a of adminList) {
      const label = a.telegramUsername
        ? `🗑 @${a.telegramUsername}`
        : `🗑 ${a.telegramId}`;
      rows.push([
        Markup.button.callback(label.slice(0, 60), `admin:remove:${a.telegramId}`),
      ]);
    }

    rows.push([
      Markup.button.callback('📊 Report', 'admin:report'),
      Markup.button.callback('← Menu', 'admin:menu'),
    ]);
    return Markup.inlineKeyboard(rows);
  }

  private buildCategoriesMessage(list: Category[]): string {
    const lines = [
      '<b>📂 Categories</b>',
      '',
      `Total: <b>${list.length}</b>`,
      '',
    ];
    if (list.length === 0) {
      lines.push('<i>No categories yet.</i>');
    } else {
      lines.push('Fee + commission = delivery per item.');
      lines.push('Tap a category to view or edit.');
      lines.push('');
      for (const c of list) {
        lines.push(`• ${this.escapeHtml(c.name)} — ${this.categoryBreakdown(c)}`);
      }
    }
    return lines.join('\n');
  }

  private categoriesKeyboard(list: Category[]) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const c of list) {
      const total = this.categoryDeliveryTotal(c);
      const tag = total > 0 ? `${total.toLocaleString('en-US')} ETB` : '—';
      const label = `${c.name} · ${tag}`.slice(0, 60);
      rows.push([Markup.button.callback(label, `admin:cat:${c.id}`)]);
    }
    rows.push([Markup.button.callback('➕ Add category', 'admin:cat:add')]);
    rows.push([Markup.button.callback('← Back to settings', 'admin:settings')]);
    return Markup.inlineKeyboard(rows);
  }

  private buildCategoryDetailMessage(category: Category): string {
    return [
      `<b>📂 ${this.escapeHtml(category.name)}</b>`,
      '',
      `Shipping fee: <b>${this.formatCategoryEtb(category.shippingCost)}</b>`,
      `Commission: <b>${this.formatCategoryEtb(category.commissionEtb)}</b>`,
      '--------------------',
      `Delivery total: <b>${this.formatCategoryEtb(this.categoryDeliveryTotal(category))}</b>`,
      '',
      '<i>Delivery total is added per item at checkout.</i>',
    ].join('\n');
  }

  private categoryDetailKeyboard(category: Category) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '✏️ Edit shipping fee',
          `admin:cat:fee:${category.id}`,
        ),
      ],
      [
        Markup.button.callback(
          '✏️ Edit commission',
          `admin:cat:comm:${category.id}`,
        ),
      ],
      [
        Markup.button.callback(
          '🗑 Clear shipping fee',
          `admin:cat:clear-fee:${category.id}`,
        ),
        Markup.button.callback(
          '🗑 Clear commission',
          `admin:cat:clear-comm:${category.id}`,
        ),
      ],
      [Markup.button.callback('🗑 Clear both', `admin:cat:clear-both:${category.id}`)],
      [Markup.button.callback('← Back to list', 'admin:categories')],
    ]);
  }

  private async showCategoryDetail(
    ctx: Context,
    categoryId: number,
    mode: 'edit' | 'reply',
  ): Promise<void> {
    const category = await this.categories.findById(categoryId);
    if (!category) {
      if (mode === 'edit') {
        await this.safeAnswer(ctx, 'Category not found.', true);
      } else {
        await ctx.reply('Category not found.');
      }
      return;
    }

    const body = this.buildCategoryDetailMessage(category);
    const options = { parse_mode: 'HTML' as const, ...this.categoryDetailKeyboard(category) };
    if (mode === 'edit') {
      try {
        await ctx.editMessageText(body, options);
      } catch (err) {
        if (this.isMessageNotModifiedError(err)) return;
        this.fileLogger.logError('showCategoryDetail', err, { categoryId });
      }
      return;
    }
    await ctx.reply(body, options);
  }

  private categoryBreakdown(category: Category): string {
    const fee = category.shippingCost;
    const commission = category.commissionEtb;
    if (fee == null && commission == null) return '<i>not set</i>';
    const total = this.categoryDeliveryTotal(category);
    return (
      `<b>${this.formatCategoryEtb(fee)}</b> + ` +
      `<b>${this.formatCategoryEtb(commission)}</b> = ` +
      `<b>${this.formatCategoryEtb(total)}</b>`
    );
  }

  private categoryDeliveryTotal(category: Category): number {
    return (category.shippingCost ?? 0) + (category.commissionEtb ?? 0);
  }

  private formatCategoryEtb(value: number | null): string {
    return value == null ? '—' : `${value.toLocaleString('en-US')} ETB`;
  }

  private parseCategoryAmount(
    text: string,
    allowSkip: boolean,
  ):
    | { kind: 'ok'; value: number | null }
    | { kind: 'cancel' }
    | { kind: 'error'; message: string } {
    const normalized = text.trim().toLowerCase();
    if (normalized === 'cancel') return { kind: 'cancel' };
    if (
      normalized === 'clear' ||
      normalized === 'null' ||
      normalized === '-' ||
      (allowSkip && (normalized === 'skip' || normalized === 'none'))
    ) {
      return { kind: 'ok', value: null };
    }

    const cleaned = text.replace(/,/g, '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
      const skipText = allowSkip ? ', "skip" to leave it unset,' : '';
      return {
        kind: 'error',
        message:
          `Invalid value. Enter a number between 0 and 1,000,000${skipText} ` +
          'or "cancel" to abort.',
      };
    }
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
      const skipText = allowSkip ? ', "skip" to leave it unset,' : '';
      return {
        kind: 'error',
        message:
          `Invalid value. Enter a number between 0 and 1,000,000${skipText} ` +
          'or "cancel" to abort.',
      };
    }
    return { kind: 'ok', value: parsed };
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const from = ctx.from;
    if (!from) return false;
    if (await this.admins.isAdmin(from.id)) return true;
    await this.safeAnswer(ctx, 'Admin access required. Send /admin first.', true);
    return false;
  }

  private buildDraftMessage(draft: OrderDraft): string {
    const categoryDisplay = draft.categoryName
      ? this.escapeHtml(draft.categoryName)
      : 'N/A';
    const lines: string[] = [
      `Product : <b>${this.escapeHtml(draft.productTitle)}</b>`,
      `Category : <b>${categoryDisplay}</b>`,
      '',
    ];

    if (draft.selectedSize) {
      lines.push(`Size: <b>${this.escapeHtml(draft.selectedSize)}</b>`);
    }
    if (draft.selectedColor) {
      lines.push(`Color: <b>${this.escapeHtml(draft.selectedColor)}</b>`);
    }
    if (draft.step === 'qty' || draft.step === 'price' || draft.step === 'confirm') {
      lines.push(`Quantity: <b>${draft.quantity}</b>`);
    } else if (draft.step === 'qty-input') {
      lines.push('Quantity: <i>pending</i>');
    }

    if (draft.step === 'confirm') {
      lines.push('');
      lines.push(`<b>Total: ${draft.totalEtb.toLocaleString('en-US')} ETB</b>`);
    }

    lines.push('');
    lines.push(`<i>${this.draftStepHint(draft)}</i>`);
    return lines.join('\n');
  }

  private draftStepHint(draft: OrderDraft): string {
    switch (draft.step) {
      case 'size':
        return 'Choose a size to continue.';
      case 'color':
        return 'Choose a color to continue.';
      case 'qty':
        return 'Choose a quantity, or tap "➕ More" to enter your own.';
      case 'qty-input':
        return 'Reply with a quantity (1–100), or tap "← Back" / "✗ Cancel".';
      case 'price':
        if (draft.scrapedUnitUsd != null) {
          return (
            'Reply with the unit price in USD you saw on SHEIN (e.g. 8.09), ' +
            'or tap "Use scraped" to accept the scraped value.'
          );
        }
        return 'Reply with the unit price in USD you saw on SHEIN (e.g. 8.09).';
      case 'confirm':
        return 'Review the summary, then confirm or cancel.';
    }
  }

  private buildDraftKeyboard(draft: OrderDraft) {
    if (draft.step === 'size') {
      return Markup.inlineKeyboard([
        ...this.chunkButtons(
          draft.sizes.map((s, i) =>
            Markup.button.callback(s.slice(0, 24), `ord:size:${i}`),
          ),
          4,
        ),
        [Markup.button.callback('✗ Cancel', 'ord:cancel')],
      ]);
    }
    if (draft.step === 'color') {
      return Markup.inlineKeyboard([
        ...this.chunkButtons(
          draft.colors.map((c, i) =>
            Markup.button.callback(c.slice(0, 24), `ord:color:${i}`),
          ),
          3,
        ),
        [Markup.button.callback('✗ Cancel', 'ord:cancel')],
      ]);
    }
    if (draft.step === 'qty') {
      const choices = [1, 2, 3, 4, 5];
      return Markup.inlineKeyboard([
        choices.map((n) => Markup.button.callback(String(n), `ord:qty:${n}`)),
        [Markup.button.callback('➕ More', 'ord:qty:more')],
        [Markup.button.callback('✗ Cancel', 'ord:cancel')],
      ]);
    }
    if (draft.step === 'qty-input') {
      return Markup.inlineKeyboard([
        [Markup.button.callback('← Back', 'ord:qty:back')],
        [Markup.button.callback('✗ Cancel', 'ord:cancel')],
      ]);
    }
    if (draft.step === 'price') {
      const scrapedLabel =
        draft.scrapedUnitUsd != null
          ? `✓ Use scraped (${this.formatUsd(draft.scrapedUnitUsd)})`
          : '✓ Use scraped';
      const rows: ReturnType<typeof Markup.button.callback>[][] = [];
      if (draft.scrapedUnitUsd != null) {
        rows.push([Markup.button.callback(scrapedLabel, 'ord:price:keep')]);
      }
      rows.push([Markup.button.callback('✗ Cancel', 'ord:cancel')]);
      return Markup.inlineKeyboard(rows);
    }
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✓ Place order', 'ord:confirm'),
        Markup.button.callback('✗ Cancel', 'ord:cancel'),
      ],
    ]);
  }

  private formatUsd(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return '$' + value.toFixed(2);
  }

  private chunkButtons<T>(items: T[], perRow: number): T[][] {
    const rows: T[][] = [];
    for (let i = 0; i < items.length; i += perRow) {
      rows.push(items.slice(i, i + perRow));
    }
    return rows;
  }

  private async editDraftMessage(ctx: Context, draft: OrderDraft): Promise<void> {
    try {
      await ctx.editMessageText(this.buildDraftMessage(draft), {
        parse_mode: 'HTML',
        ...this.buildDraftKeyboard(draft),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('orderDraftRender', err);
    }
  }

  private stripStatusLines(text: string): string {
    return text
      .split('\n')
      .filter((line) => !/^\s*[⏳✗✓]/.test(line))
      .join('\n')
      .replace(/\n+$/, '');
  }

  private async updateOrderMessage(
    ctx: Context,
    currentText: string,
    statusLine: string,
    keyboard: ReturnType<typeof Markup.inlineKeyboard>,
  ): Promise<void> {
    const cleaned = this.stripStatusLines(currentText);
    const newText = `${cleaned}\n\n${statusLine}`;
    try {
      await ctx.editMessageText(newText, keyboard);
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('editMessage', err);
    }
  }

  private async replaceStatusAndRemoveButtons(
    ctx: Context,
    statusLine: string,
  ): Promise<void> {
    const cbMessage = ctx.callbackQuery?.message as { text?: string } | undefined;
    const currentText = cbMessage?.text || '';
    const cleaned = this.stripStatusLines(currentText);
    const newText = `${cleaned}\n\n${statusLine}`;
    try {
      await ctx.editMessageText(newText);
      await ctx.editMessageReplyMarkup(undefined);
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('editMessage', err);
    }
  }

  private async safeAnswer(ctx: Context, text: string, alert: boolean): Promise<void> {
    try {
      await ctx.answerCbQuery(text, { show_alert: alert });
    } catch (err) {
      if (this.isExpiredCallbackError(err)) return;
      this.fileLogger.logError('orderAck', err);
    }
  }

  private isExpiredCallbackError(err: unknown): boolean {
    const message = (err as { message?: string })?.message || '';
    return /query is too old|response timeout expired|query ID is invalid/i.test(message);
  }

  private isMessageNotModifiedError(err: unknown): boolean {
    const message = (err as { message?: string })?.message || '';
    return /message is not modified/i.test(message);
  }
}

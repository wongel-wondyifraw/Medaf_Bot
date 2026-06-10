import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Command, Ctx, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { AdminsService } from '../admins/admins.service';
import { AdminNotificationsService } from '../admins/admin-notifications.service';
import { orderApprovalInlineKeyboard } from '../admins/order-approval-inline';
import { AddPriceStateService } from '../admins/add-price-state.service';
import {
  AdminAuthStateService,
  PendingAction,
} from '../admins/admin-auth-state.service';
import { CalculatorService } from '../calculator/calculator.service';
import { DubaiEstimatorService } from '../calculator/dubai-estimator.service';
import { resolveBroadGroup } from '../calculator/broad-group';
import { CategoriesService } from '../categories/categories.service';
import { buildCategoryLinkContext } from '../categories/category-link-context';
import { CategoryEditStateService } from '../categories/category-edit-state.service';
import { Category } from '../categories/category.entity';
import { formatGmtPlus3 } from '../common/date-format';
import { FileLoggerService } from '../common/logger.service';
import { AppConfig } from '../config/configuration';
import { HealthNotificationsService } from '../health/health-notifications.service';
import { HealthReportService } from '../health/health-report.service';
import { OrdersService, computeDownPaymentEtb } from '../orders/orders.service';
import { Order } from '../orders/order.entity';
import {
  OrderDraft,
  OrderDraftStateService,
} from '../orders/order-draft-state.service';
import { ResellersService } from '../resellers/resellers.service';
import { LinkResolverService } from '../scraper/link-resolver.service';
import { SharePreviewService } from '../scraper/share-preview.service';
import {
  extractFreeText,
  extractSlugTitle,
} from '../scraper/manual-order.utils';
import { ObservationsService } from '../observations/observations.service';
import { ScraperService } from '../scraper/scraper.service';
import { parseShein, ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);
  private readonly myOrdersButtonLabel = '📋 My orders';
  private readonly updateButtonLabel = '🔄 Update';
  private readonly pendingOrdersButtonLabel = '✅ Pending orders';

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly resellers: ResellersService,
    private readonly orders: OrdersService,
    private readonly orderDraft: OrderDraftStateService,
    private readonly admins: AdminsService,
    private readonly adminNotifications: AdminNotificationsService,
    private readonly adminAuth: AdminAuthStateService,
    private readonly scraper: ScraperService,
    private readonly linkResolver: LinkResolverService,
    private readonly sharePreview: SharePreviewService,
    private readonly calculator: CalculatorService,
    private readonly dubaiEstimator: DubaiEstimatorService,
    private readonly observations: ObservationsService,
    private readonly addPriceState: AddPriceStateService,
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
    await this.handleUserStart(ctx, false);
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

  @Command('myorders')
  async onMyOrders(@Ctx() ctx: Context) {
    await this.replyMyOrders(ctx);
  }

  @Action('user:myorders')
  async onMyOrdersButton(@Ctx() ctx: Context) {
    await this.safeAnswer(ctx, '', false);
    await this.replyMyOrders(ctx);
  }

  @Command('release')
  async onReleaseCommand(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    if (!(await this.admins.isAdmin(from.id))) {
      await ctx.reply('Unknown command.');
      return;
    }

    const body = this.buildReleaseNoteMessage();
    const counts = await this.countReleaseRecipients();

    await ctx.reply(
      '👀 <i>Below is exactly what registered users will receive:</i>',
      { parse_mode: 'HTML' },
    );
    await ctx.reply(body, {
      parse_mode: 'HTML',
      ...(await this.stickyReplyKeyboardFor(from.id, true)),
    });
    await ctx.reply(
      `📤 Send this v2.0 release note to <b>${counts.total}</b> people?\n` +
        `<i>(${counts.registeredResellers} registered resellers + ${counts.admins} admins, duplicates removed)</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✓ Yes, send it', 'release:confirm'),
            Markup.button.callback('✗ Cancel', 'release:cancel'),
          ],
        ]),
      },
    );
  }

  @Action('release:cancel')
  async onReleaseCancel(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Release note not sent.', false);
    try {
      await ctx.editMessageText('Release note cancelled — nothing was sent.', {
        parse_mode: 'HTML',
      });
      await ctx.editMessageReplyMarkup(undefined);
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('releaseCancel', err);
    }
  }

  @Action('release:confirm')
  async onReleaseSend(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;

    await this.safeAnswer(ctx, 'Sending release notes…', false);

    const body = this.buildReleaseNoteMessage();
    const recipientIds = await this.collectReleaseRecipientIds();
    let sent = 0;
    let failed = 0;

    for (const telegramId of recipientIds) {
      try {
        await this.bot.telegram.sendMessage(telegramId, body, {
          parse_mode: 'HTML',
          ...(await this.stickyReplyKeyboardFor(telegramId, true)),
        });
        sent++;
      } catch (err) {
        failed++;
        const e = err as Error;
        this.logger.warn(`Release note failed for ${telegramId}: ${e.message}`);
      }
      await this.sleep(35);
    }

    this.logger.log(
      `Release note v2.0 sent by admin ${from.id}: ${sent} ok, ${failed} failed`,
    );

    try {
      await ctx.editMessageText(
        `✅ Release note sent to <b>${sent}</b> user(s).${failed > 0 ? ` Failed: <b>${failed}</b>.` : ''}`,
        { parse_mode: 'HTML' },
      );
      await ctx.editMessageReplyMarkup(undefined);
    } catch (err) {
      if (!this.isMessageNotModifiedError(err)) {
        await ctx.reply(
          `✅ Release note sent to <b>${sent}</b> user(s).${failed > 0 ? ` Failed: <b>${failed}</b>.` : ''}`,
          { parse_mode: 'HTML' },
        );
      }
    }
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
      await this.stickyReplyKeyboardFor(from.id),
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    const from = ctx.from;
    const message = ctx.message as { text?: string } | undefined;
    if (!from || !message?.text) return;
    const text = message.text.trim();

    if (text === this.myOrdersButtonLabel) {
      await this.replyMyOrders(ctx);
      return;
    }

    if (text === this.updateButtonLabel) {
      await this.handleUserStart(ctx, true);
      return;
    }

    if (text === this.pendingOrdersButtonLabel) {
      if (!(await this.admins.isAdmin(from.id))) {
        await ctx.reply('Admin access required. Send /admin first.');
        return;
      }
      await this.replyAdminApprovalQueue(ctx);
      return;
    }

    const pending = this.adminAuth.getPending(from.id);
    if (pending) {
      await this.handlePendingAction(ctx, from.id, from.username, pending, text);
      return;
    }

    // Order-draft text routing. Each step that expects free-form text from
    // the user (custom quantity, unit USD price) is dispatched here before
    // any of the registration / SHEIN-link checks below.
    const activeDraft = this.orderDraft.getDraft(from.id);
    if (activeDraft && activeDraft.step === 'preferences') {
      await this.handleOrderPreferencesInput(ctx, from.id, text);
      return;
    }
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
   * Starts an order draft for any valid SHEIN link without calling paid
   * scraping providers. Titles come from pasted text, the URL slug, or a
   * single plain HTTP fetch of share-link HTML (same source as Telegram previews).
   */
  private async startManualOrder(
    ctx: Context,
    userId: number,
    rawMessage: string,
    url: string,
    productId: string | null,
  ): Promise<void> {
    await ctx.reply('Preparing product details, please wait...');

    const freeText = extractFreeText(rawMessage);
    const slugTitle = extractSlugTitle(url);

    const fetched = await this.sharePreview.tryFetch(url);
    await this.simulateScrapeDelay();

    const resolvedProductId = productId ?? fetched?.productId ?? null;
    const productTitle =
      (freeText && freeText.length >= 4 ? freeText : null) ??
      fetched?.title ??
      slugTitle ??
      (resolvedProductId ? `SHEIN product ${resolvedProductId}` : 'SHEIN product');

    const linkContext = buildCategoryLinkContext({
      title: productTitle,
      url,
      rawMessage,
      productId: resolvedProductId,
      imageUrl: fetched?.image ?? null,
      slugTitle,
      freeText,
    });
    const categoryOutcome = await this.categories.resolveCategoryForProduct(linkContext);
    const category = categoryOutcome.category;

    if (categoryOutcome.created && category) {
      await this.notifyAdminsAiCategoryCreated(
        category,
        productTitle,
        categoryOutcome.peerCategoryName,
      );
    }

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
      image: fetched?.image ?? null,
      productId: resolvedProductId,
      domain: this.safeHostname(url),
      source: 'manual',
      sizes: [],
      colors: [],
      breadcrumb: category ? [category.name] : [],
    };

    const totals = await this.calculator.calculateOrderTotalEtb(synthesized);

    // unitEtb/sellingEtb/totalEtb stay at 0 until the user enters the USD
    // price on the price step — the calculator will recompute them then.
    const draft = this.orderDraft.setDraft(userId, {
      productId: resolvedProductId,
      link: url,
      productTitle,
      sizes: [],
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
        `category="${category?.name ?? 'default'}" source=${categoryOutcome.source}`,
    );

    await ctx.reply(this.buildDraftMessage(draft), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(draft),
    });
  }

  private async notifyAdminsAiCategoryCreated(
    category: Category,
    sourceTitle: string,
    peerCategoryName: string | null | undefined,
  ): Promise<void> {
    const admins = await this.admins.findAll();
    if (admins.length === 0) return;

    const factors = [
      category.dubaiFactorLow ?? category.dubaiFactor,
      category.dubaiFactorAvg,
      category.dubaiFactorHigh,
    ]
      .filter((v): v is number => v != null)
      .map((v) => v.toFixed(2))
      .join(' / ');

    const peerLine = peerCategoryName
      ? `Shipping/commission copied from <b>${this.escapeHtml(peerCategoryName)}</b>.`
      : 'Shipping/commission not set (no peer in group).';

    const message =
      `<b>AI created category</b> <b>${this.escapeHtml(category.name)}</b>\n` +
      `From title: ${this.escapeHtml(sourceTitle.slice(0, 120))}\n` +
      `Dubai factors: ${this.escapeHtml(factors || 'defaults')}\n` +
      `${peerLine}\n` +
      `Review in Categories.`;

    for (const admin of admins) {
      try {
        await this.bot.telegram.sendMessage(admin.telegramId, message, {
          parse_mode: 'HTML',
        });
      } catch (err) {
        const e = err as Error;
        this.logger.warn(
          `Failed to notify admin ${admin.telegramId} about AI category: ${e.message}`,
        );
      }
    }
  }

  private safeHostname(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return 'shein.com';
    }
  }

  /**
   * Brief delay before showing the draft so the response feels natural.
   * Skipped during tests via NODE_ENV check.
   */
  private simulateScrapeDelay(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return Promise.resolve();
    const ms = 1200 + Math.floor(Math.random() * 600); // 1.2s–1.8s
    return new Promise((resolve) => setTimeout(resolve, ms));
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

      const summary =
        this.buildDraftMessage(draft) + '\n\n⏳ Submitted — awaiting admin approval';
      try {
        await ctx.editMessageText(summary, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback('❌ Cancel request', `cancel:${order.id}`),
          ]),
        });
      } catch (err) {
        if (!this.isMessageNotModifiedError(err)) {
          this.fileLogger.logError('orderConfirmEdit', err);
        }
      }
      await this.adminNotifications.notifyAdminsNewOrder(order);
      await this.safeAnswer(ctx, 'Request submitted! We will review it shortly.', false);
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

      if (order.status === 'completed') {
        await this.safeAnswer(ctx, 'This order was already completed.', true);
        return;
      }

      if (order.status === 'pending') {
        await this.safeAnswer(ctx, 'This order is already confirmed and cannot be cancelled here.', true);
        return;
      }

      if (order.status !== 'awaiting_approval' && order.status !== 'awaiting_payment') {
        await this.safeAnswer(ctx, 'This order cannot be cancelled.', true);
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

  @Action(/^pay:confirm:(\d+)$/)
  async onPaymentConfirm(@Ctx() ctx: Context) {
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
        await this.safeAnswer(ctx, 'You can only confirm your own orders.', true);
        return;
      }

      if (order.status === 'pending' || order.status === 'completed') {
        await this.replaceStatusAndRemoveButtons(ctx, '✓ Payment confirmed — order placed');
        await this.safeAnswer(ctx, 'Payment was already confirmed.', false);
        return;
      }

      if (order.status === 'cancelled') {
        await this.safeAnswer(ctx, 'This order was cancelled.', true);
        return;
      }

      if (order.status !== 'awaiting_payment') {
        await this.safeAnswer(ctx, 'This order is not awaiting payment.', true);
        return;
      }

      const updated = await this.orders.confirmPayment(orderId);
      if (!updated) {
        await this.safeAnswer(ctx, 'Could not confirm payment. Please try again.', true);
        return;
      }

      this.logger.log(`Order #${orderId} payment confirmed by reseller ${reseller.id}`);

      try {
        await ctx.editMessageText(
          this.buildPaymentConfirmedMessage(updated) +
            '\n\n✓ Order placed — Medaf collation will process your order',
          { parse_mode: 'HTML' },
        );
      } catch (err) {
        if (!this.isMessageNotModifiedError(err)) {
          this.fileLogger.logError('paymentConfirmEdit', err);
        }
      }
      await this.safeAnswer(ctx, 'Order placed!', false);
    } catch (err) {
      this.fileLogger.logError('paymentConfirm', err, { orderId });
      await this.safeAnswer(ctx, 'Could not confirm payment. Please try again.', true);
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

  @Action('admin:edit:bank-account')
  async onEditBankAccount(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-bank-account');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply('Enter the bank account number or payment details for down payments:');
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

  @Action('admin:edit:rate-aed')
  async onEditRateAed(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-rate-aed');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply('Enter new USD → AED rate, e.g. 3.67:');
  }

  @Action('admin:edit:ceiling')
  async onEditCeiling(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-ceiling');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply(
      'Enter the price ceiling multiplier for the HIGH factor step.\n\n' +
        'Examples: <code>1.20</code> = allow up to 20% above anchor, ' +
        '<code>1.30</code> = up to 30%.',
      { parse_mode: 'HTML' },
    );
  }

  @Action('admin:edit:final-mult')
  async onEditFinalMult(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-final-mult');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply(
      'Enter the final price uplift multiplier applied to every price.\n\n' +
        'Examples: <code>1.00</code> = no change, <code>1.10</code> = +10%, ' +
        '<code>1.15</code> = +15%.',
      { parse_mode: 'HTML' },
    );
  }

  @Command('addprice')
  async onAddPriceCommand(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    if (!(await this.admins.isAdmin(from.id))) {
      await ctx.reply('Admin access required. Send /admin first.');
      return;
    }
    this.addPriceState.clear(from.id);
    this.adminAuth.setPending(from.id, 'addprice-link');
    await ctx.reply(
      'Send the SHEIN product link (must end with <code>-p-&lt;number&gt;.html</code>).',
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^admin:addprice:cat:(.+)$/)
  async onAddPricePickCategory(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;

    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const categoryName = this.decodeCategoryName(match?.[1] || '');
    if (!categoryName) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }

    const draft = this.addPriceState.setCategory(from.id, categoryName);
    if (!draft) {
      await this.safeAnswer(ctx, 'Session expired. Send /addprice again.', true);
      return;
    }

    this.adminAuth.setPending(from.id, 'addprice-eth-usd');
    await this.safeAnswer(ctx, `Category: ${categoryName}`, false);
    await ctx.reply(
      'Send the Ethiopia-view USD price you see on SHEIN (e.g. <code>12.50</code>).',
      { parse_mode: 'HTML' },
    );
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
    await this.safeAnswer(ctx, 'Loading delivery queue...', false);
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

  @Action('admin:approval')
  async onAdminApproval(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Loading approval queue...', false);
    try {
      const awaiting = await this.orders.findAwaitingApproval();
      await ctx.editMessageText(this.buildApprovalMessage(awaiting), {
        parse_mode: 'HTML',
        ...this.approvalKeyboard(awaiting),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminApproval', err);
    }
  }

  @Action(/^admin:approve:(\d+)$/)
  async onAdminApprove(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const orderId = parseInt(match?.[1] || '0', 10);
    if (!orderId) {
      await this.safeAnswer(ctx, 'Invalid order.', true);
      return;
    }

    const bankAccount = await this.getPaymentBankAccount();
    if (!bankAccount) {
      await this.safeAnswer(
        ctx,
        'Set the payment bank account in Settings before approving orders.',
        true,
      );
      return;
    }

    try {
      const order = await this.orders.findById(orderId);
      if (!order) {
        await this.safeAnswer(ctx, 'Order not found.', true);
        return;
      }
      if (order.status === 'awaiting_payment') {
        await this.safeAnswer(ctx, `Order #${orderId} is already approved.`, false);
        return;
      }
      if (order.status !== 'awaiting_approval') {
        await this.safeAnswer(ctx, 'This order is not awaiting approval.', true);
        return;
      }

      const updated = await this.orders.approve(orderId);
      if (!updated) {
        await this.safeAnswer(ctx, 'Could not approve order.', true);
        return;
      }

      const from = ctx.from;
      this.logger.log(`Order #${orderId} approved by admin telegramId=${from?.id}`);
      await this.sendPaymentRequestToReseller(updated, bankAccount);
      await this.safeAnswer(ctx, `✓ Order #${orderId} approved.`, false);

      const feedUpdated = await this.finalizeAdminOrderFeedMessage(
        ctx,
        orderId,
        '✅ <b>Approved</b> — payment request sent to reseller.',
      );
      if (!feedUpdated) {
        const awaiting = await this.orders.findAwaitingApproval();
        try {
          await ctx.editMessageText(this.buildApprovalMessage(awaiting), {
            parse_mode: 'HTML',
            ...this.approvalKeyboard(awaiting),
          });
        } catch (err) {
          if (this.isMessageNotModifiedError(err)) return;
          throw err;
        }
      }
    } catch (err) {
      this.fileLogger.logError('adminApprove', err, { orderId });
      await this.safeAnswer(ctx, 'Could not approve order. Please try again.', true);
    }
  }

  @Action(/^admin:adjust:(\d+)$/)
  async onAdminAdjustPrice(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const orderId = parseInt(match?.[1] || '0', 10);
    if (!orderId) {
      await this.safeAnswer(ctx, 'Invalid order.', true);
      return;
    }

    const order = await this.orders.findById(orderId);
    if (!order || order.status !== 'awaiting_approval') {
      await this.safeAnswer(ctx, 'Order not found or not awaiting approval.', true);
      return;
    }

    this.adminAuth.setPendingForOrder(from.id, 'adjust-price', orderId);
    await this.safeAnswer(ctx, '', false);
    await this.finalizeAdminOrderFeedMessage(
      ctx,
      orderId,
      '<i>Enter the correct total ETB price in chat…</i>',
    );
    await ctx.reply(
      `Enter the correct total selling price in ETB for order #${orderId} (e.g. 3500):`,
    );
  }

  @Action(/^admin:reject:(\d+)$/)
  async onAdminReject(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const orderId = parseInt(match?.[1] || '0', 10);
    if (!orderId) {
      await this.safeAnswer(ctx, 'Invalid order.', true);
      return;
    }

    const order = await this.orders.findById(orderId);
    if (!order || order.status !== 'awaiting_approval') {
      await this.safeAnswer(ctx, 'Order not found or not awaiting approval.', true);
      return;
    }

    this.adminAuth.setPendingForOrder(from.id, 'reject-reason', orderId);
    await this.safeAnswer(ctx, '', false);
    await this.finalizeAdminOrderFeedMessage(
      ctx,
      orderId,
      '<i>Reply with rejection reason in chat…</i>',
    );
    await ctx.reply(`Enter the rejection reason for order #${orderId}:`);
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
    const rawSuffix = match?.[1] || '';
    const suffix = rawSuffix.trim();
    this.logger.log(
      `admin:cat callback userId=${from.id} suffix=[${suffix}] raw=[${rawSuffix}]`,
    );

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

    const nameMatch = suffix.match(/^name:(.+)$/);
    if (nameMatch) {
      const categoryName = this.decodeCategoryName(nameMatch[1]);
      if (!categoryName) {
        await this.safeAnswer(ctx, 'Invalid category.', true);
        return;
      }
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
      await this.safeAnswer(ctx, '', false);
      await this.showCategoryDetailByName(ctx, categoryName, 'edit');
      return;
    }

    const nameFieldMatch = suffix.match(
      /^(fee-name|comm-name|factor-name|factor-low-name|factor-avg-name|factor-high-name):(.+)$/,
    );
    if (nameFieldMatch) {
      const categoryName = this.decodeCategoryName(nameFieldMatch[2]);
      if (!categoryName) {
        await this.safeAnswer(ctx, 'Invalid category.', true);
        return;
      }
      if (nameFieldMatch[1] === 'factor-name' || nameFieldMatch[1] === 'factor-low-name') {
        await this.handleCategoryEditFactorLowPromptByName(ctx, from.id, categoryName);
        return;
      }
      if (nameFieldMatch[1] === 'factor-avg-name') {
        await this.handleCategoryEditFactorAvgPromptByName(ctx, from.id, categoryName);
        return;
      }
      if (nameFieldMatch[1] === 'factor-high-name') {
        await this.handleCategoryEditFactorHighPromptByName(ctx, from.id, categoryName);
        return;
      }
      const field =
        nameFieldMatch[1] === 'comm-name' ? 'commission' : 'shipping fee';
      await this.handleCategoryEditFieldPromptByName(
        ctx,
        from.id,
        field,
        categoryName,
      );
      return;
    }

    const nameClearMatch = suffix.match(/^clear-(fee-name|comm-name|both-name):(.+)$/);
    if (nameClearMatch) {
      const field =
        nameClearMatch[1] === 'fee-name'
          ? 'fee'
          : nameClearMatch[1] === 'comm-name'
            ? 'comm'
            : 'both';
      const categoryName = this.decodeCategoryName(nameClearMatch[2]);
      if (!categoryName) {
        await this.safeAnswer(ctx, 'Invalid category.', true);
        return;
      }
      await this.handleCategoryClearByName(ctx, from.id, field, categoryName);
      return;
    }

    // Legacy id-based callbacks. Render has used UUID ids while local dev uses
    // integer ids, so these are kept only for old chat messages.
    const clearMatch = suffix.match(/^clear-(fee|comm|both):(.+)$/);
    if (clearMatch) {
      const field = clearMatch[1] as 'fee' | 'comm' | 'both';
      await this.handleCategoryClear(ctx, from.id, field, clearMatch[2]);
      return;
    }

    // Legacy keyboards (pre-fee/commission split) sent `clear:<id>` to wipe
    // the single shipping cost. Treat it as "clear both" so old chat
    // messages keep working after redeploy.
    const legacyClearMatch = suffix.match(/^clear:(.+)$/);
    if (legacyClearMatch) {
      await this.handleCategoryClear(ctx, from.id, 'both', legacyClearMatch[1]);
      return;
    }

    const fieldMatch = suffix.match(/^(fee|comm):(.+)$/);
    if (fieldMatch) {
      const field = fieldMatch[1] === 'comm' ? 'commission' : 'shipping fee';
      await this.handleCategoryEditFieldPrompt(ctx, from.id, field, fieldMatch[2]);
      return;
    }

    // Anything else is treated as a raw category id (digits or UUID).
    this.adminAuth.clearPending(from.id);
    this.categoryEditState.clearPending(from.id);
    await this.safeAnswer(ctx, '', false);
    await this.showCategoryDetail(ctx, suffix, 'edit');
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
    categoryId: number | string,
  ): Promise<void> {
    if (categoryId === '' || categoryId == null) {
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

  private async handleCategoryEditFieldPromptByName(
    ctx: Context,
    userId: number,
    field: 'commission' | 'shipping fee',
    categoryName: string,
  ): Promise<void> {
    const category = await this.categories.findByName(categoryName);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(
      userId,
      field === 'commission' ? 'edit-category-commission' : 'edit-category-fee',
    );
    this.categoryEditState.setPending(userId, category.name);
    await this.safeAnswer(ctx, '', false);

    const current =
      field === 'commission' ? category.commissionEtb : category.shippingCost;
    const body =
      `<b>✏️ ${this.escapeHtml(category.name)} — ${field}</b>\n\n` +
      `Current: <b>${this.formatCategoryEtb(current)}</b>\n\n` +
      'Send the new amount in ETB (example: <code>600</code>).\n' +
      'Send <code>clear</code> to remove this value, or <code>cancel</code> to return.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('← Back', this.categoryNameAction(category))],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEditFieldByName', err, {
        categoryName,
        field,
      });
    }
  }

  private async handleCategoryClear(
    ctx: Context,
    userId: number,
    field: 'fee' | 'comm' | 'both',
    categoryId: number | string,
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

  private async handleCategoryClearByName(
    ctx: Context,
    userId: number,
    field: 'fee' | 'comm' | 'both',
    categoryName: string,
  ): Promise<void> {
    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPending(userId);
    try {
      const updated =
        field === 'fee'
          ? await this.categories.setShippingCostByName(categoryName, null)
          : field === 'comm'
            ? await this.categories.setCommissionEtbByName(categoryName, null)
            : await this.categories.clearCostsByName(categoryName);
      if (!updated) {
        await this.safeAnswer(ctx, 'Category not found.', true);
        return;
      }
      const label =
        field === 'fee' ? 'shipping fee' : field === 'comm' ? 'commission' : 'costs';
      await this.safeAnswer(ctx, `Cleared ${label} for ${updated.name}.`, false);
      await this.showCategoryDetailByName(ctx, updated.name, 'edit');
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryClearByName', err, {
        categoryName,
        field,
      });
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
      case 'edit-rate-aed':
        await this.handleSettingValue(ctx, userId, SETTING_KEYS.USD_TO_AED, text, {
          min: 0.1,
          max: 100,
          label: 'USD → AED rate',
          suffix: '',
        });
        break;
      case 'edit-ceiling':
        await this.handleSettingValue(
          ctx,
          userId,
          SETTING_KEYS.PRICING_CEILING_MULTIPLIER,
          text,
          {
            min: 1,
            max: 3,
            label: 'Price ceiling multiplier',
            suffix: '×',
          },
        );
        break;
      case 'edit-final-mult':
        await this.handleSettingValue(
          ctx,
          userId,
          SETTING_KEYS.PRICING_FINAL_MULTIPLIER,
          text,
          {
            min: 1,
            max: 3,
            label: 'Final price uplift',
            suffix: '×',
          },
        );
        break;
      case 'edit-category-factor':
        await this.handleEditCategoryFactorLow(ctx, userId, text);
        break;
      case 'edit-category-factor-low':
        await this.handleEditCategoryFactorLow(ctx, userId, text);
        break;
      case 'edit-category-factor-avg':
        await this.handleEditCategoryFactorAvg(ctx, userId, text);
        break;
      case 'edit-category-factor-high':
        await this.handleEditCategoryFactorHigh(ctx, userId, text);
        break;
      case 'addprice-link':
        await this.handleAddPriceLink(ctx, userId, text);
        break;
      case 'addprice-eth-usd':
        await this.handleAddPriceEthUsd(ctx, userId, text);
        break;
      case 'addprice-aed':
        await this.handleAddPriceAed(ctx, userId, text);
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
      case 'edit-bank-account':
        await this.handleEditBankAccount(ctx, userId, text);
        break;
      case 'adjust-price':
        await this.handleAdjustPrice(ctx, userId, text);
        break;
      case 'reject-reason':
        await this.handleRejectReason(ctx, userId, text);
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

  private async handleOrderPreferencesInput(
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
    if (trimmed.length < 1 || trimmed.length > 200) {
      await ctx.reply(
        'Please enter your preferences in one message (1–200 characters), e.g. ' +
          '<code>Size M, Black</code>.',
        { parse_mode: 'HTML' },
      );
      return;
    }

    const updated = this.orderDraft.setPreferences(userId, trimmed);
    if (!updated) {
      await ctx.reply('Order session expired. Send the link again.');
      return;
    }

    await ctx.reply(this.buildDraftMessage(updated), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(updated),
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
    try {
      const priced = await this.calculator.priceFromEthUsd({
        ethUsd: userUnitUsd,
        productId: draft.productId,
        categoryName: draft.categoryName,
        deliveryEtb: draft.deliveryEtb,
        quantity: draft.quantity,
      });

      return this.orderDraft.setUserPrice(userId, {
        userUnitUsd,
        unitEtb: priced.unitEtbPerUnit,
        sellingEtb: priced.totalEtb,
        totalEtb: priced.totalEtb,
        marginPercent: priced.marginPercent,
        rateUsed: priced.rateUsed,
        dubaiUsd: priced.dubaiUsd,
        dubaiAed: priced.dubaiAed,
        factorUsed: priced.factorUsed,
        factorTier: priced.factorTier,
        factorReason: priced.factorReason,
        baseEtbRef: priced.baseEtbRef,
        baseAed: priced.baseAed,
        dubaiCostEtb: priced.dubaiCostEtb,
        sellEtb: priced.sellEtb,
        profitEtb: priced.profitEtb,
        usdToAed: priced.usdToAed,
        confidence: priced.confidence,
        triggers: priced.triggers,
      });
    } catch (err) {
      this.fileLogger.logError('applyUserPrice', err, { userId });
      return null;
    }
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

    const categoryKey = this.categoryEditState.getPending(userId);
    if (!categoryKey) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Edit session expired. Open the category list again.');
      return;
    }

    const parsed = this.parseCategoryAmount(text, false);
    if (parsed.kind === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPending(userId);
      if (typeof categoryKey === 'string' && !/^\d+$/.test(categoryKey)) {
        await this.showCategoryDetailByName(ctx, categoryKey, 'reply');
      } else {
        await this.showCategoryDetail(ctx, categoryKey, 'reply');
      }
      return;
    }
    if (parsed.kind === 'error') {
      await ctx.reply(parsed.message);
      return;
    }

    const updated =
      field === 'fee'
        ? typeof categoryKey === 'string' && !/^\d+$/.test(categoryKey)
          ? await this.categories.setShippingCostByName(categoryKey, parsed.value)
          : await this.categories.setShippingCost(categoryKey, parsed.value)
        : typeof categoryKey === 'string' && !/^\d+$/.test(categoryKey)
          ? await this.categories.setCommissionEtbByName(categoryKey, parsed.value)
          : await this.categories.setCommissionEtb(categoryKey, parsed.value);
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
      `Category ${categoryKey} (${updated.name}) ${label} ${formatted} by admin ${userId}`,
    );
    await ctx.reply(
      `✅ <b>${this.escapeHtml(updated.name)}</b> ${label} ${formatted}.`,
      { parse_mode: 'HTML' },
    );

    await this.showCategoryDetailByName(ctx, updated.name, 'reply');
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

  private async getPaymentBankAccount(): Promise<string | null> {
    const raw = await this.settings.get(SETTING_KEYS.PAYMENT_BANK_ACCOUNT);
    const trimmed = (raw || '').trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async handleEditBankAccount(ctx: Context, userId: number, text: string): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const value = text.trim();
    if (!value || value.length > 200) {
      await ctx.reply('Enter a valid bank account or payment details (max 200 characters).');
      return;
    }

    await this.settings.set(SETTING_KEYS.PAYMENT_BANK_ACCOUNT, value);
    this.adminAuth.clearPending(userId);
    this.logger.log(`Payment bank account updated by admin ${userId}`);
    await ctx.reply('✅ Bank account updated.');
    await ctx.reply(await this.buildSettingsMessage(), {
      parse_mode: 'HTML',
      ...(await this.buildSettingsKeyboard()),
    });
  }

  private async handleAdjustPrice(ctx: Context, userId: number, text: string): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const orderId = this.adminAuth.getPendingOrderId(userId);
    if (!orderId) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Session expired. Open Approval queue and try again.');
      return;
    }

    const bankAccount = await this.getPaymentBankAccount();
    if (!bankAccount) {
      await ctx.reply('Set the payment bank account in Settings before adjusting prices.');
      return;
    }

    const value = parseFloat(text.replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) {
      await ctx.reply('Invalid price. Enter a positive number in ETB, e.g. 3500.');
      return;
    }

    const orderBefore = await this.orders.findById(orderId);
    if (!orderBefore || orderBefore.status !== 'awaiting_approval') {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Order not found or no longer awaiting approval.');
      return;
    }

    const originalEtb = orderBefore.originalSellingEtb ?? orderBefore.sellingEtb;
    const updated = await this.orders.overridePrice(orderId, value);
    this.adminAuth.clearPending(userId);

    if (!updated) {
      await ctx.reply('Could not update price. Please try again.');
      return;
    }

    this.logger.log(
      `Order #${orderId} price adjusted to ${updated.sellingEtb} ETB by admin ${userId}`,
    );

    if (updated.sellingEtb < originalEtb) {
      await this.sendDiscountMessageToReseller(updated, originalEtb);
    } else if (updated.sellingEtb > originalEtb) {
      await this.sendPriceCorrectionMessageToReseller(updated, originalEtb);
    }
    await this.sendPaymentRequestToReseller(updated, bankAccount);
    await ctx.reply(
      `✅ Order #${orderId} price set to ${updated.sellingEtb.toLocaleString('en-US')} ETB. User notified.`,
    );
  }

  private async handleRejectReason(ctx: Context, userId: number, text: string): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const orderId = this.adminAuth.getPendingOrderId(userId);
    if (!orderId) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Session expired. Open Approval queue and try again.');
      return;
    }

    const reason = text.trim();
    if (!reason || reason.length > 500) {
      await ctx.reply('Enter a rejection reason (max 500 characters).');
      return;
    }

    const updated = await this.orders.reject(orderId, reason);
    this.adminAuth.clearPending(userId);

    if (!updated) {
      await ctx.reply('Could not reject order. It may have already been processed.');
      return;
    }

    this.logger.log(`Order #${orderId} rejected by admin ${userId}`);
    await this.sendRejectionToReseller(updated);
    await ctx.reply(`✗ Order #${orderId} rejected. User notified.`);
  }

  private formatDiscountPercent(originalEtb: number, newEtb: number): number | null {
    if (originalEtb <= 0 || newEtb >= originalEtb) return null;
    return Math.round(((originalEtb - newEtb) / originalEtb) * 100);
  }

  private formatPriceCorrectionPercent(originalEtb: number, newEtb: number): number | null {
    if (originalEtb <= 0 || newEtb <= originalEtb) return null;
    return Math.round(((newEtb - originalEtb) / originalEtb) * 100);
  }

  private async sendDiscountMessageToReseller(order: Order, originalEtb: number): Promise<void> {
    const fullOrder = await this.orders.findByIdWithReseller(order.id);
    if (!fullOrder?.reseller?.telegramId) return;

    const discountPct = this.formatDiscountPercent(originalEtb, order.sellingEtb);
    if (discountPct == null || discountPct <= 0) return;

    const lines = [
      '<b>Good news!</b>',
      '',
      `Medaf collation issued a <b>${discountPct}%</b> discount on your order.`,
      '',
      `Order <b>#${order.id}</b>`,
    ];

    try {
      await this.bot.telegram.sendMessage(fullOrder.reseller.telegramId, lines.join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      this.fileLogger.logError('sendDiscountMessage', err, { orderId: order.id });
    }
  }

  private async sendPriceCorrectionMessageToReseller(order: Order, originalEtb: number): Promise<void> {
    const fullOrder = await this.orders.findByIdWithReseller(order.id);
    if (!fullOrder?.reseller?.telegramId) return;

    const correctionPct = this.formatPriceCorrectionPercent(originalEtb, order.sellingEtb);
    if (correctionPct == null || correctionPct <= 0) return;

    const lines = [
      '<b>A quick note from Medaf collation</b>',
      '',
      `After reviewing your order, we applied a <b>${correctionPct}%</b> price correction to reflect the actual cost.`,
      'Thank you for your understanding.',
      '',
      `Order <b>#${order.id}</b>`,
    ];

    try {
      await this.bot.telegram.sendMessage(fullOrder.reseller.telegramId, lines.join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      this.fileLogger.logError('sendPriceCorrectionMessage', err, { orderId: order.id });
    }
  }

  private async sendRejectionToReseller(order: Order): Promise<void> {
    const fullOrder = await this.orders.findByIdWithReseller(order.id);
    if (!fullOrder?.reseller?.telegramId) return;

    const reason = this.escapeHtml(order.rejectionReason || 'No reason provided.');
    const lines = [
      `<b>Order #${order.id} was not approved by Medaf collation</b>`,
      '',
      reason,
    ];

    try {
      await this.bot.telegram.sendMessage(fullOrder.reseller.telegramId, lines.join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      this.fileLogger.logError('sendRejection', err, { orderId: order.id });
    }
  }

  private async sendPaymentRequestToReseller(
    order: Order,
    bankAccount: string,
  ): Promise<void> {
    const fullOrder = await this.orders.findByIdWithReseller(order.id);
    if (!fullOrder?.reseller?.telegramId) return;

    const downPayment =
      order.downPaymentEtb ?? computeDownPaymentEtb(order.sellingEtb);
    const message = this.buildPaymentRequestMessage(order, bankAccount, downPayment);

    try {
      await this.bot.telegram.sendMessage(fullOrder.reseller.telegramId, message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Paid', `pay:confirm:${order.id}`),
            Markup.button.callback('❌ Cancel', `cancel:${order.id}`),
          ],
        ]),
      });
    } catch (err) {
      this.fileLogger.logError('sendPaymentRequest', err, { orderId: order.id });
    }
  }

  private buildPaymentRequestMessage(
    order: Order,
    bankAccount: string,
    downPaymentEtb: number,
  ): string {
    return [
      `<b>Order #${order.id} approved by Medaf collation</b>`,
      '',
      `Total: <b>${order.sellingEtb.toLocaleString('en-US')} ETB</b>`,
      `Down payment (50%): <b>${downPaymentEtb.toLocaleString('en-US')} ETB</b>`,
      `Transfer to: <b>${this.escapeHtml(bankAccount)}</b>`,
      '',
      'Tap below after you have paid.',
    ].join('\n');
  }

  private buildPaymentConfirmedMessage(order: Order): string {
    const downPayment =
      order.downPaymentEtb ?? computeDownPaymentEtb(order.sellingEtb);
    return [
      `<b>Order #${order.id}</b>`,
      '',
      `Total: <b>${order.sellingEtb.toLocaleString('en-US')} ETB</b>`,
      `Down payment received: <b>${downPayment.toLocaleString('en-US')} ETB</b>`,
    ].join('\n');
  }

  private buildReleaseNoteMessage(): string {
    return [
      '🎉 <b>Medaf Bot v2.0 is live!</b>',
      '',
      'We\u2019ve updated the bot to make ordering clearer and pricing fairer. Here\u2019s what\u2019s new:',
      '',
      '━━━━━━━━━━━━━━━━',
      '',
      '💰 <b>Better cost management</b>',
      'Medaf collation reviews every order before you pay. If we can lower the price, you\u2019ll get a discount 🎁. If our estimate was off, we\u2019ll explain a small price correction politely.',
      '',
      '💳 <b>Simpler payments</b>',
      'After approval, transfer <b>50%</b> to our bank account and tap <b>✅ Paid</b> in the bot. Your order is confirmed right away.',
      '',
      '📋 <b>See your orders</b>',
      'Check all your orders and their status anytime — use the <b>My orders</b> button at the bottom of your chat.',
      '',
      '🔄 <b>Important — tap Update</b>',
      'Please tap <b>🔄 Update</b> at the bottom of your chat to refresh the bot and load v2.0.',
      '',
      '━━━━━━━━━━━━━━━━',
      '',
      '🙏 Thank you for ordering with <b>Medaf collation</b>.',
    ].join('\n');
  }

  private async countReleaseRecipients(): Promise<{
    total: number;
    registeredResellers: number;
    admins: number;
  }> {
    const ids = await this.collectReleaseRecipientIds();
    const registered = await this.resellers.findAllRegistered();
    const adminList = await this.admins.findAll();
    return {
      total: ids.size,
      registeredResellers: registered.length,
      admins: adminList.length,
    };
  }

  private async collectReleaseRecipientIds(): Promise<Set<string>> {
    const registered = await this.resellers.findAllRegistered();
    const adminList = await this.admins.findAll();
    const ids = new Set<string>();
    for (const r of registered) ids.add(r.telegramId);
    for (const a of adminList) ids.add(a.telegramId);
    return ids;
  }

  private buildStickyReplyKeyboard(opts: { includeUpdate?: boolean; isAdmin?: boolean }) {
    const row1 = opts.includeUpdate
      ? [this.updateButtonLabel, this.myOrdersButtonLabel]
      : [this.myOrdersButtonLabel];
    const rows: string[][] = [row1];
    if (opts.isAdmin) {
      rows.push([this.pendingOrdersButtonLabel]);
    }
    return Markup.keyboard(rows).resize().persistent();
  }

  private async stickyReplyKeyboardFor(
    telegramId: number | string | undefined,
    includeUpdate = false,
  ) {
    const isAdmin =
      telegramId != null && (await this.admins.isAdmin(telegramId));
    return this.buildStickyReplyKeyboard({ includeUpdate, isAdmin });
  }

  private async replyAdminApprovalQueue(ctx: Context): Promise<void> {
    const awaiting = await this.orders.findAwaitingApproval();
    const from = ctx.from;
    await ctx.reply(this.buildApprovalMessage(awaiting), {
      parse_mode: 'HTML',
      ...this.approvalKeyboard(awaiting),
      ...(await this.stickyReplyKeyboardFor(from?.id)),
    });
  }

  private async handleUserStart(ctx: Context, refreshed: boolean): Promise<void> {
    const from = ctx.from;
    if (from) {
      this.adminAuth.clearPending(from.id);
      this.orderDraft.clearDraft(from.id);
    }
    const reseller = await this.ensureReseller(ctx);
    if (!reseller) return;
    if (reseller.isRegistered()) {
      const intro = refreshed
        ? '✅ <b>Medaf Bot updated!</b> You\u2019re on the latest version.\n\nSend a SHEIN product link to place your order.'
        : 'Welcome to Medaf SHEIN orders.\nSend a SHEIN product link to place your order.';
      await ctx.reply(intro, {
        parse_mode: refreshed ? 'HTML' : undefined,
        ...(await this.stickyReplyKeyboardFor(from?.id)),
      });
      return;
    }
    if (!reseller.fullName) {
      await this.askForName(ctx);
    } else if (!reseller.phoneNumber) {
      await this.askForPhone(ctx);
    } else {
      await ctx.reply(
        'Welcome to Medaf SHEIN orders.\nSend a SHEIN product link to place your order.',
        await this.stickyReplyKeyboardFor(from?.id),
      );
    }
  }

  private async replyMyOrders(ctx: Context): Promise<void> {
    const from = ctx.from;
    if (!from) return;

    const reseller = await this.resellers.findByTelegramId(from.id);
    if (!reseller?.isRegistered()) {
      await ctx.reply('Please complete registration with /start before viewing orders.');
      return;
    }

    const orders = await this.orders.findByResellerId(reseller.id);
    await ctx.reply(this.buildMyOrdersMessage(orders), {
      parse_mode: 'HTML',
      ...(await this.stickyReplyKeyboardFor(from.id)),
    });
  }

  private buildMyOrdersMessage(orders: Order[]): string {
    const lines = [
      '<b>📋 My orders</b>',
      '',
      `Showing your last <b>${orders.length}</b> order(s).`,
    ];

    if (orders.length === 0) {
      lines.push('', '<i>No orders yet. Send a SHEIN link to place your first order.</i>');
      return lines.join('\n');
    }

    for (const o of orders) {
      const title = this.escapeHtml((o.productTitle || 'Product').slice(0, 50));
      const status = this.formatResellerOrderStatus(o.status);
      const price = `${o.sellingEtb.toLocaleString('en-US')} ETB`;
      const date = this.escapeHtml(formatGmtPlus3(o.createdAt));
      const variant = this.formatOrderVariant(o);
      lines.push('');
      lines.push(`<b>#${o.id}</b> — ${status}`);
      lines.push(`${title}`);
      lines.push(`${price} · ${date}`);
      if (variant) lines.push(this.escapeHtml(variant));
    }

    lines.push('', '<i>Send a SHEIN link to place a new order.</i>');
    return lines.join('\n');
  }

  private formatResellerOrderStatus(status: Order['status']): string {
    switch (status) {
      case 'awaiting_approval':
        return '⏳ Awaiting Medaf collation approval';
      case 'awaiting_payment':
        return '💳 Awaiting your payment';
      case 'pending':
        return '📦 Confirmed — in progress';
      case 'completed':
        return '✓ Completed';
      case 'cancelled':
        return '✗ Cancelled';
      default:
        return status;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendAdminMenu(ctx: Context): Promise<void> {
    const from = ctx.from;
    await ctx.reply(this.buildAdminMenuText(from?.id), {
      parse_mode: 'HTML',
      ...this.adminMenuKeyboard(from?.id),
    });
    if (from) {
      await ctx.reply(
        'Admin shortcut: tap <b>Pending orders</b> on the bottom bar anytime.',
        {
          parse_mode: 'HTML',
          ...(await this.stickyReplyKeyboardFor(from.id)),
        },
      );
    }
  }

  private adminMenuKeyboard(telegramId?: number) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [
        Markup.button.callback('📊 Report', 'admin:report'),
        Markup.button.callback('✅ Approval', 'admin:approval'),
      ],
      [Markup.button.callback('📦 Delivery queue', 'admin:pending')],
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
      '• <b>Approval</b> — review new order requests',
      '• <b>Delivery queue</b> — mark confirmed orders as delivered',
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
    const total =
      report.awaitingApproval +
      report.awaitingPayment +
      report.pending +
      report.cancelled +
      report.completed;
    const lines = [
      '<b>📊 Orders report</b>',
      '',
      `<b>Total orders:</b> ${total}`,
      `✅ Awaiting approval: <b>${report.awaitingApproval}</b>   💳 Awaiting payment: <b>${report.awaitingPayment}</b>`,
      `📦 Delivery queue: <b>${report.pending}</b>   ✗ Cancelled: <b>${report.cancelled}</b>   ✓ Completed: <b>${report.completed}</b>`,
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

  private buildApprovalMessage(
    awaiting: Awaited<ReturnType<OrdersService['findAwaitingApproval']>>,
  ): string {
    const lines = [
      '<b>✅ Awaiting approval</b>',
      '',
      `Total: <b>${awaiting.length}</b>`,
    ];

    if (awaiting.length === 0) {
      lines.push('', '<i>No orders awaiting approval.</i>');
      return lines.join('\n');
    }

    awaiting.forEach((o, idx) => {
      const r = (o as unknown as {
        reseller?: { fullName?: string | null; phoneNumber?: string | null };
      }).reseller;
      const name = this.escapeHtml(r?.fullName || 'unknown');
      const phone = this.escapeHtml(this.formatPhone(r?.phoneNumber));
      const title = this.escapeHtml((o.productTitle || '').slice(0, 60));
      lines.push('');
      lines.push(`<b>Order ${idx + 1}</b>`);
      lines.push(`  ID:      #${o.id}`);
      lines.push(`  Submitted: ${this.escapeHtml(formatGmtPlus3(o.createdAt))}`);
      lines.push(`  Product: ${title}`);
      const variant = this.formatOrderVariant(o);
      if (variant) lines.push(`  Variant: ${this.escapeHtml(variant)}`);
      lines.push(`  Price:   ${this.formatOrderPrice(o)}`);
      lines.push(`  Name:    ${name}`);
      lines.push(`  Phone:   ${phone}`);
      const link = this.formatOrderLink(o);
      if (link) lines.push(`  Link:    ${link}`);
    });

    lines.push('', '<i>Use the buttons below to approve, adjust price, or reject.</i>');
    return lines.join('\n');
  }

  private approvalKeyboard(
    awaiting: Awaited<ReturnType<OrdersService['findAwaitingApproval']>>,
  ) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const o of awaiting) {
      rows.push([
        Markup.button.callback(`✓ Approve #${o.id}`, `admin:approve:${o.id}`),
        Markup.button.callback(`✏️ Price #${o.id}`, `admin:adjust:${o.id}`),
        Markup.button.callback(`✗ Reject #${o.id}`, `admin:reject:${o.id}`),
      ]);
    }
    rows.push([
      Markup.button.callback('📦 Delivery queue', 'admin:pending'),
      Markup.button.callback('📊 Report', 'admin:report'),
    ]);
    rows.push([Markup.button.callback('← Back to menu', 'admin:menu')]);
    return Markup.inlineKeyboard(rows);
  }

  private buildPendingMessage(
    pending: Awaited<ReturnType<OrdersService['findPending']>>,
  ): string {
    const lines = [
      '<b>📦 Delivery queue</b>',
      '',
      `Awaiting delivery: <b>${pending.length}</b>`,
    ];

    if (pending.length === 0) {
      lines.push('', '<i>No orders in the delivery queue.</i>');
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
      Markup.button.callback('✅ Approval', 'admin:approval'),
      Markup.button.callback('📊 Report', 'admin:report'),
    ]);
    rows.push([Markup.button.callback('⚙️ Settings', 'admin:settings')]);
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
    if (status === 'awaiting_approval') return '✅ Awaiting approval';
    if (status === 'awaiting_payment') return '💳 Awaiting payment';
    if (status === 'pending') return '📦 Delivery queue';
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
    const ceiling = await this.settings.getNumber(
      SETTING_KEYS.PRICING_CEILING_MULTIPLIER,
      pricing.ceilingMultiplier,
    );
    const ceilingPct = Math.round((ceiling - 1) * 100);
    const finalMult = await this.settings.getNumber(
      SETTING_KEYS.PRICING_FINAL_MULTIPLIER,
      pricing.finalMultiplier,
    );
    const finalPct = Math.round((finalMult - 1) * 100);
    const adminList = await this.admins.findAll();

    const lines = [
      '<b>⚙️ Settings</b>',
      '',
      '<b>Pricing</b> (tap a button to edit)',
      '• Profit margin (dynamic; tier picked from Dubai product cost ETB only; delivery added after):',
      '   – &lt; 3,000 ETB → <b>30%</b>',
      '   – 3,000–10,000 ETB → <b>20%</b>',
      '   – &gt; 10,000 ETB → <b>15%</b>',
      '• Totals are rounded <b>up</b> after multiplying by quantity.',
      `• Default delivery fallback: <b>${delivery.toLocaleString('en-US')} ETB</b>`,
      '• Category delivery: shipping fee + commission, used when a category matches',
      `• USD → ETB: <b>${usd > 0 ? usd : 'not set'}</b>`,
      `• USD → AED: <b>${await this.formatUsdToAedSetting()}</b>`,
      `• Price ceiling: <b>${ceiling.toFixed(2)}×</b> (HIGH factor allowed up to <b>${ceilingPct}%</b> above anchor)`,
      `• Final price uplift: <b>${finalMult.toFixed(2)}×</b> (${finalPct >= 0 ? '+' : ''}${finalPct}% on every price)`,
      '',
      '<b>Payments</b>',
      `• Down payment bank account: <b>${this.escapeHtml(await this.getPaymentBankAccount() || 'not set')}</b>`,
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
      [Markup.button.callback('✏️ USD→AED', 'admin:edit:rate-aed')],
      [
        Markup.button.callback('✏️ Price ceiling ×', 'admin:edit:ceiling'),
        Markup.button.callback('✏️ Final uplift ×', 'admin:edit:final-mult'),
      ],
      [Markup.button.callback('✏️ Bank account', 'admin:edit:bank-account')],
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
      rows.push([Markup.button.callback(label, this.categoryNameAction(c))]);
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
      `Low factor: <b>${this.formatDubaiFactor(category.dubaiFactorLow ?? category.dubaiFactor)}</b>`,
      `Avg factor: <b>${this.formatDubaiFactor(category.dubaiFactorAvg)}</b>`,
      `High factor: <b>${this.formatDubaiFactor(category.dubaiFactorHigh)}</b>`,
      '--------------------',
      `Delivery total: <b>${this.formatCategoryEtb(this.categoryDeliveryTotal(category))}</b>`,
      '',
      '<i>Three-factor engine: try LOW, then HIGH (ceiling), then AVG. Margin on Dubai cost only; delivery added after.</i>',
    ].join('\n');
  }

  private categoryDetailKeyboard(category: Category) {
    const token = this.categoryNameToken(category.name);
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '✏️ Edit shipping fee',
          `admin:cat:fee-name:${token}`,
        ),
      ],
      [
        Markup.button.callback(
          '✏️ Edit commission',
          `admin:cat:comm-name:${token}`,
        ),
      ],
      [
        Markup.button.callback(
          '✏️ Edit low factor',
          `admin:cat:factor-low-name:${token}`,
        ),
      ],
      [
        Markup.button.callback(
          '✏️ Edit avg factor',
          `admin:cat:factor-avg-name:${token}`,
        ),
      ],
      [
        Markup.button.callback(
          '✏️ Edit high factor',
          `admin:cat:factor-high-name:${token}`,
        ),
      ],
      [
        Markup.button.callback(
          '🗑 Clear shipping fee',
          `admin:cat:clear-fee-name:${token}`,
        ),
        Markup.button.callback(
          '🗑 Clear commission',
          `admin:cat:clear-comm-name:${token}`,
        ),
      ],
      [Markup.button.callback('🗑 Clear both', `admin:cat:clear-both-name:${token}`)],
      [Markup.button.callback('← Back to list', 'admin:categories')],
    ]);
  }

  private async showCategoryDetail(
    ctx: Context,
    categoryId: number | string,
    mode: 'edit' | 'reply',
  ): Promise<void> {
    let category: Category | null = null;
    try {
      category = await this.categories.findById(categoryId);
    } catch (err) {
      // Some old chat keyboards may contain ids that no longer match the
      // current schema (e.g. integer vs UUID after a DB swap). Log and bail
      // gracefully instead of crashing the bot.
      this.fileLogger.logError('showCategoryDetail.findById', err, {
        categoryId,
      });
    }
    if (!category) {
      if (mode === 'edit') {
        await this.safeAnswer(
          ctx,
          'Category not found. Re-open Settings → Categories.',
          true,
        );
      } else {
        await ctx.reply('Category not found. Re-open Settings → Categories.');
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

  private async showCategoryDetailByName(
    ctx: Context,
    categoryName: string,
    mode: 'edit' | 'reply',
  ): Promise<void> {
    const category = await this.categories.findByName(categoryName);
    if (!category) {
      if (mode === 'edit') {
        await this.safeAnswer(
          ctx,
          'Category not found. Re-open Settings → Categories.',
          true,
        );
      } else {
        await ctx.reply('Category not found. Re-open Settings → Categories.');
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
        this.fileLogger.logError('showCategoryDetailByName', err, { categoryName });
      }
      return;
    }
    await ctx.reply(body, options);
  }

  private categoryNameAction(category: Category): string {
    return `admin:cat:name:${this.categoryNameToken(category.name)}`;
  }

  private categoryNameToken(name: string): string {
    return encodeURIComponent(name);
  }

  private decodeCategoryName(token: string): string | null {
    try {
      const decoded = decodeURIComponent(token);
      return decoded.trim() ? decoded : null;
    } catch {
      return null;
    }
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

  private async formatUsdToAedSetting(): Promise<string> {
    const pricing = this.config.get('pricing', { infer: true });
    const aed = await this.settings.getNumber(
      SETTING_KEYS.USD_TO_AED,
      pricing.usdToAed ?? 3.67,
    );
    return aed > 0 ? String(aed) : 'not set';
  }

  private formatDubaiFactor(value: number | null): string {
    return value == null ? '—' : value.toFixed(4);
  }

  private parseDubaiFactor(
    text: string,
  ):
    | { kind: 'ok'; value: number | null }
    | { kind: 'cancel' }
    | { kind: 'error'; message: string } {
    const normalized = text.trim().toLowerCase();
    if (normalized === 'cancel') return { kind: 'cancel' };
    if (normalized === 'clear' || normalized === 'null' || normalized === '-') {
      return { kind: 'ok', value: null };
    }

    const cleaned = text.replace(/,/g, '.').trim();
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
      return {
        kind: 'error',
        message:
          'Invalid factor. Enter a decimal between 0.01 and 1.00 (e.g. 0.76), ' +
          '<code>clear</code> to reset, or <code>cancel</code> to abort.',
      };
    }
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
      return {
        kind: 'error',
        message: 'Factor must be between 0.01 and 1.00.',
      };
    }
    return { kind: 'ok', value: parsed };
  }

  private parseDubaiFactorHigh(
    text: string,
  ):
    | { kind: 'ok'; value: number | null }
    | { kind: 'cancel' }
    | { kind: 'error'; message: string } {
    const normalized = text.trim().toLowerCase();
    if (normalized === 'cancel') return { kind: 'cancel' };
    if (normalized === 'clear' || normalized === 'null' || normalized === '-') {
      return { kind: 'ok', value: null };
    }

    const cleaned = text.replace(/,/g, '.').trim();
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
      return {
        kind: 'error',
        message:
          'Invalid factor. Enter a decimal between 0.01 and 3.00 (e.g. 1.10), ' +
          '<code>clear</code> to reset, or <code>cancel</code> to abort.',
      };
    }
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 3) {
      return {
        kind: 'error',
        message: 'High factor must be between 0.01 and 3.00.',
      };
    }
    return { kind: 'ok', value: parsed };
  }

  private async handleCategoryEditFactorLowPromptByName(
    ctx: Context,
    userId: number,
    categoryName: string,
  ): Promise<void> {
    const category = await this.categories.findByName(categoryName);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(userId, 'edit-category-factor-low');
    this.categoryEditState.setPending(userId, category.name);
    await this.safeAnswer(ctx, '', false);

    const current = category.dubaiFactorLow ?? category.dubaiFactor;
    const body =
      `<b>✏️ ${this.escapeHtml(category.name)} — low factor</b>\n\n` +
      `Current: <b>${this.formatDubaiFactor(current)}</b>\n\n` +
      'Step 1 of the three-factor engine.\n' +
      'Send the new factor (example: <code>0.55</code>).\n' +
      'Send <code>clear</code> to remove, or <code>cancel</code> to return.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('← Back', this.categoryNameAction(category))],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEditFactorLow', err, { categoryName });
    }
  }

  private async handleEditCategoryFactorLow(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    await this.handleEditCategoryFactorTier(ctx, userId, text, 'low');
  }

  private async handleCategoryEditFactorAvgPromptByName(
    ctx: Context,
    userId: number,
    categoryName: string,
  ): Promise<void> {
    const category = await this.categories.findByName(categoryName);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(userId, 'edit-category-factor-avg');
    this.categoryEditState.setPending(userId, category.name);
    await this.safeAnswer(ctx, '', false);

    const body =
      `<b>✏️ ${this.escapeHtml(category.name)} — avg factor</b>\n\n` +
      `Current: <b>${this.formatDubaiFactor(category.dubaiFactorAvg)}</b>\n\n` +
      'Step 3 fallback of the three-factor engine.\n' +
      'Send the new factor (example: <code>0.88</code>).\n' +
      'Send <code>clear</code> to remove, or <code>cancel</code> to return.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('← Back', this.categoryNameAction(category))],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEditFactorAvg', err, { categoryName });
    }
  }

  private async handleEditCategoryFactorAvg(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    await this.handleEditCategoryFactorTier(ctx, userId, text, 'avg');
  }

  private async handleEditCategoryFactorTier(
    ctx: Context,
    userId: number,
    text: string,
    tier: 'low' | 'avg' | 'high',
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const categoryKey = this.categoryEditState.getPending(userId);
    if (!categoryKey) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Edit session expired. Open the category list again.');
      return;
    }

    const parsed =
      tier === 'high' ? this.parseDubaiFactorHigh(text) : this.parseDubaiFactor(text);
    if (parsed.kind === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPending(userId);
      if (typeof categoryKey === 'string' && !/^\d+$/.test(categoryKey)) {
        await this.showCategoryDetailByName(ctx, categoryKey, 'reply');
      } else {
        await this.showCategoryDetail(ctx, categoryKey, 'reply');
      }
      return;
    }
    if (parsed.kind === 'error') {
      await ctx.reply(parsed.message, { parse_mode: 'HTML' });
      return;
    }

    const byName = typeof categoryKey === 'string' && !/^\d+$/.test(categoryKey);
    let updated: Category | null = null;
    if (tier === 'low') {
      updated = byName
        ? await this.categories.setDubaiFactorLowByName(categoryKey, parsed.value)
        : await this.categories.setDubaiFactorLow(categoryKey, parsed.value);
    } else if (tier === 'avg') {
      updated = byName
        ? await this.categories.setDubaiFactorAvgByName(categoryKey, parsed.value)
        : await this.categories.setDubaiFactorAvg(categoryKey, parsed.value);
    } else {
      updated = byName
        ? await this.categories.setDubaiFactorHighByName(categoryKey, parsed.value)
        : await this.categories.setDubaiFactorHigh(categoryKey, parsed.value);
    }

    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPending(userId);

    if (!updated) {
      await ctx.reply('Category not found.');
      return;
    }

    const value =
      tier === 'low'
        ? updated.dubaiFactorLow ?? updated.dubaiFactor
        : tier === 'avg'
          ? updated.dubaiFactorAvg
          : updated.dubaiFactorHigh;

    await ctx.reply(
      `✅ <b>${this.escapeHtml(updated.name)}</b> ${tier} factor ` +
        `<b>${this.formatDubaiFactor(value)}</b>.`,
      { parse_mode: 'HTML' },
    );
    await this.showCategoryDetailByName(ctx, updated.name, 'reply');
  }

  private async handleCategoryEditFactorHighPromptByName(
    ctx: Context,
    userId: number,
    categoryName: string,
  ): Promise<void> {
    const category = await this.categories.findByName(categoryName);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(userId, 'edit-category-factor-high');
    this.categoryEditState.setPending(userId, category.name);
    await this.safeAnswer(ctx, '', false);

    const body =
      `<b>✏️ ${this.escapeHtml(category.name)} — high Dubai factor</b>\n\n` +
      `Current: <b>${this.formatDubaiFactor(category.dubaiFactorHigh)}</b>\n\n` +
      'Step 2 of the three-factor engine (ceiling check).\n' +
      'Send the new factor (example: <code>1.25</code>, may exceed 1.00).\n' +
      'Send <code>clear</code> to remove, or <code>cancel</code> to return.';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('← Back', this.categoryNameAction(category))],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEditFactorHigh', err, { categoryName });
    }
  }

  private async handleEditCategoryFactorHigh(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    await this.handleEditCategoryFactorTier(ctx, userId, text, 'high');
  }

  private buildAddPriceCategoryKeyboard(list: Category[]) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const c of list) {
      const token = this.categoryNameToken(c.name);
      rows.push([
        Markup.button.callback(
          c.name.slice(0, 60),
          `admin:addprice:cat:${token}`,
        ),
      ]);
    }
    rows.push([Markup.button.callback('✗ Cancel', 'admin:cat:cancel')]);
    return Markup.inlineKeyboard(rows);
  }

  private async handleAddPriceLink(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    if (text.trim().toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Cancelled.');
      return;
    }

    let productId: string;
    try {
      const parsed = parseShein(text.trim());
      productId = parsed.productId;
    } catch (err) {
      await ctx.reply(
        (err as Error).message ||
          'Please send a valid SHEIN product link ending with -p-<number>.html',
      );
      return;
    }

    this.addPriceState.setLink(userId, productId, text.trim());
    this.adminAuth.clearPending(userId);

    const list = await this.categories.findAll();
    await ctx.reply('Choose the product category:', {
      ...this.buildAddPriceCategoryKeyboard(list),
    });
  }

  private async handleAddPriceEthUsd(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const draft = this.addPriceState.get(userId);
    if (!draft?.categoryName) {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Session expired. Send /addprice again.');
      return;
    }

    if (text.trim().toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Cancelled.');
      return;
    }

    const parsed = this.parseUsdInput(text);
    if (parsed == null || parsed <= 0 || parsed > 100_000) {
      await ctx.reply('Send a valid USD price (e.g. 12.50) or cancel.');
      return;
    }

    this.addPriceState.setEthUsd(userId, parsed);
    this.adminAuth.setPending(userId, 'addprice-aed');
    await ctx.reply(
      'Send the verified Dubai AED price (e.g. <code>35</code>).',
      { parse_mode: 'HTML' },
    );
  }

  private async handleAddPriceAed(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const draft = this.addPriceState.get(userId);
    if (!draft?.categoryName || draft.ethUsd == null) {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Session expired. Send /addprice again.');
      return;
    }

    if (text.trim().toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.addPriceState.clear(userId);
      await ctx.reply('Cancelled.');
      return;
    }

    const cleaned = text.replace(/,/g, '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
      await ctx.reply('Send a valid AED amount (e.g. 35) or cancel.');
      return;
    }
    const aed = parseFloat(cleaned);
    if (!Number.isFinite(aed) || aed <= 0 || aed > 1_000_000) {
      await ctx.reply('AED price must be between 0.01 and 1,000,000.');
      return;
    }

    const usdToAed = await this.dubaiEstimator.resolveUsdToAed();
    const broadGroup = resolveBroadGroup(draft.categoryName);

    await this.observations.recordObservation({
      productId: draft.productId,
      productLink: draft.productLink,
      categoryName: draft.categoryName,
      broadGroup,
      ethUsd: draft.ethUsd,
      aedPrice: aed,
      usdToAed,
    });

    const count = await this.observations.countByProduct(draft.productId);
    const dubaiUsd = aed / usdToAed;
    const factor = draft.ethUsd > 0 ? dubaiUsd / draft.ethUsd : 1;

    this.adminAuth.clearPending(userId);
    this.addPriceState.clear(userId);

    await ctx.reply(
      `Recorded. <code>${draft.productId}</code> now has <b>${count}</b> observation(s).\n` +
        `Implied factor <b>${factor.toFixed(4)}</b> (Dubai $${dubaiUsd.toFixed(2)} on Eth $${draft.ethUsd.toFixed(2)}).`,
      { parse_mode: 'HTML' },
    );
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
      '🛍️ <b>' + this.escapeHtml(draft.productTitle) + '</b>',
      `Category: <b>${categoryDisplay}</b>`,
      '',
    ];

    if (draft.preferencesText) {
      lines.push(`Preferences: <b>${this.escapeHtml(draft.preferencesText)}</b>`);
    }
    if (draft.step === 'qty' || draft.step === 'price' || draft.step === 'confirm') {
      lines.push(`Quantity: <b>${draft.quantity}</b>`);
    } else if (draft.step === 'qty-input') {
      lines.push('Quantity: <i>pending</i>');
    }

    if (draft.step === 'confirm') {
      lines.push('');
      lines.push(`<b>Estimated Cost: ${draft.totalEtb.toLocaleString('en-US')} ETB</b>`);
    }

    lines.push('');
    lines.push(`<i>${this.draftStepHint(draft)}</i>`);
    return lines.join('\n');
  }

  private draftStepHint(draft: OrderDraft): string {
    switch (draft.step) {
      case 'preferences':
        return 'Reply with your preferences (size, color, etc.) — e.g. Size M, Black.';
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
    if (draft.step === 'preferences') {
      return Markup.inlineKeyboard([
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

  private async finalizeAdminOrderFeedMessage(
    ctx: Context,
    orderId: number,
    statusLine: string,
  ): Promise<boolean> {
    const cbMessage = ctx.callbackQuery?.message as { text?: string } | undefined;
    const currentText = cbMessage?.text || '';
    if (!currentText.includes(`#${orderId}`) || !currentText.includes('awaiting approval')) {
      return false;
    }
    const cleaned = this.stripStatusLines(currentText);
    try {
      await ctx.editMessageText(`${cleaned}\n\n${statusLine}`, { parse_mode: 'HTML' });
      await ctx.editMessageReplyMarkup(undefined);
      return true;
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return true;
      this.fileLogger.logError('finalizeAdminOrderFeed', err, { orderId });
      return false;
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

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { AdminsService } from '../admins/admins.service';
import {
  AdminAuthStateService,
  PendingAction,
} from '../admins/admin-auth-state.service';
import { CalculatorService } from '../calculator/calculator.service';
import { CategoriesService } from '../categories/categories.service';
import { CategoryEditStateService } from '../categories/category-edit-state.service';
import { Category } from '../categories/category.entity';
import { FileLoggerService } from '../common/logger.service';
import { AppConfig } from '../config/configuration';
import { OrdersService } from '../orders/orders.service';
import { Order } from '../orders/order.entity';
import {
  OrderDraft,
  OrderDraftStateService,
} from '../orders/order-draft-state.service';
import { ResellersService } from '../resellers/resellers.service';
import { ScraperService } from '../scraper/scraper.service';
import { ScrapedProduct } from '../scraper/types';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

const SHEIN_BUTTON_LABEL = '🛍 Open SHEIN (US)';
const SHEIN_BROWSE_URL = 'https://us.shein.com/';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  /**
   * Persistent bottom-of-chat keyboard that surfaces a "go to SHEIN" shortcut
   * on every screen. We use a plain reply-keyboard button (URL buttons can
   * only live inside inline keyboards) and intercept the label in onText to
   * answer with an inline URL button that opens us.shein.com.
   */
  private sheinReplyKeyboard() {
    return Markup.keyboard([[Markup.button.text(SHEIN_BUTTON_LABEL)]])
      .resize()
      .persistent();
  }

  private sheinInlineKeyboard() {
    return Markup.inlineKeyboard([[Markup.button.url('Open us.shein.com', SHEIN_BROWSE_URL)]]);
  }

  private async replyWithSheinLink(ctx: Context): Promise<void> {
    await ctx.reply(
      'Tap below to open the US SHEIN site. Browse the catalog, copy the product link, then paste it back here to place an order.',
      this.sheinInlineKeyboard(),
    );
  }

  constructor(
    private readonly resellers: ResellersService,
    private readonly orders: OrdersService,
    private readonly orderDraft: OrderDraftStateService,
    private readonly admins: AdminsService,
    private readonly adminAuth: AdminAuthStateService,
    private readonly scraper: ScraperService,
    private readonly calculator: CalculatorService,
    private readonly settings: SettingsService,
    private readonly categories: CategoriesService,
    private readonly categoryEditState: CategoryEditStateService,
    private readonly fileLogger: FileLoggerService,
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
      'Welcome! Before you can use the bot, please complete a quick registration.\n\n' +
        'What is your full name?',
      Markup.removeKeyboard(),
    );
  }

  private askForPhone(ctx: Context) {
    return ctx.reply(
      'Thanks! Now please share your phone number using the button below.',
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
        `Welcome back, ${reseller.fullName}! Send me a Shein product link to get a price.`,
        this.sheinReplyKeyboard(),
      );
      return;
    }
    if (!reseller.fullName) {
      await this.askForName(ctx);
    } else if (!reseller.phoneNumber) {
      await this.askForPhone(ctx);
    } else {
      await ctx.reply('You are all set. Send a Shein product link.');
    }
  }

  @Command('shein')
  async onSheinCommand(@Ctx() ctx: Context) {
    await this.replyWithSheinLink(ctx);
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

    const isAdmin = await this.admins.isAdmin(from.id);
    if (!isAdmin) {
      await ctx.reply('You are not an admin.');
      return;
    }

    const password = this.config.get('adminPassword', { infer: true });
    if (!password) {
      await ctx.reply('Admin access is not configured on this bot.');
      return;
    }

    this.adminAuth.setPending(from.id, 'admin-revoke');
    await ctx.reply('🔓 Revoke admin access\n\nEnter the admin password to confirm:');
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
      `Thanks, ${reseller.fullName}! Registration complete.\nSend a Shein product link to get a price.`,
      this.sheinReplyKeyboard(),
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

    // If the user is on the price step of an order draft, treat their text as
    // the USD unit price they actually want to use (or "cancel").
    const activeDraft = this.orderDraft.getDraft(from.id);
    if (activeDraft && activeDraft.step === 'price') {
      await this.handleOrderPriceInput(ctx, from.id, activeDraft, text);
      return;
    }

    // The persistent reply keyboard sends the button label as plain text, so
    // intercept it here before the SHEIN URL check below (which would treat
    // it as an invalid link because the label contains the word "SHEIN").
    if (text === SHEIN_BUTTON_LABEL) {
      await this.replyWithSheinLink(ctx);
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
      await ctx.reply('Please send a SHEIN product link (the URL that ends with "-p-<number>.html").');
      return;
    }

    try {
      await ctx.reply('Fetching product details, please wait...');
      const product = await this.scraper.scrapeProduct(text);
      const totals = await this.calculator.calculateOrderTotalEtb(product);

      // At draft creation quantity is 1, so seller-side per-unit ETB is the
      // sellingEtb returned by the calculator. Delivery is added on top once
      // (it does not multiply with quantity later on).
      const draft = this.orderDraft.setDraft(from.id, {
        productId: product.productId,
        link: text,
        productTitle: product.title,
        sizes: product.sizes,
        colors: product.colors,
        scrapedUnitUsd: totals.scrapedUnitUsd,
        unitEtb: totals.sellingEtb,
        sellingEtb: totals.sellingEtb,
        totalEtb: totals.sellingEtb + totals.deliveryEtb,
        deliveryEtb: totals.deliveryEtb,
        marginPercent: totals.marginPercent,
        rateUsed: totals.rateUsed,
      });

      await ctx.reply(this.buildDraftMessage(draft), {
        parse_mode: 'HTML',
        ...this.buildDraftKeyboard(draft),
      });
    } catch (err) {
      this.fileLogger.logError('scrape', err, { url: text, chatId: ctx.chat?.id });
      if (await this.tryStartFallbackOrder(ctx, from.id, text, err)) return;
      const userMessage = FileLoggerService.isNetworkError(err)
        ? 'Network error reaching the scraping provider. Make sure your internet/VPN/proxy is working and try again.'
        : `Sorry, I could not process that link.\n${(err as Error).message}`;
      await ctx.reply(userMessage).catch((e) => this.fileLogger.logError('reply', e));
    }
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
    const updated = this.applyUserPrice(from.id, draft, draft.scrapedUnitUsd);
    if (!updated) return;
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
      await ctx.editMessageText(this.buildReportMessage(report), {
        parse_mode: 'HTML',
        ...this.adminMenuKeyboard(),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminReport', err);
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

  @Action('admin:edit:margin')
  async onEditMargin(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'edit-margin');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply('Enter new profit margin (%), e.g. 30:');
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

  @Action('admin:cat:add')
  async onAdminCategoryAdd(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    this.adminAuth.setPending(from.id, 'add-category');
    await this.safeAnswer(ctx, '', false);
    await ctx.reply(
      'Enter the new category name (1–80 characters).\nSend <code>cancel</code> to abort.',
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^admin:cat:(\d+)$/)
  async onAdminCategoryEdit(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (!from) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const categoryId = parseInt(match?.[1] || '0', 10);
    if (!categoryId) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }
    const category = await this.categories.findById(categoryId);
    if (!category) {
      await this.safeAnswer(ctx, 'Category not found.', true);
      return;
    }

    this.adminAuth.setPending(from.id, 'edit-category-cost');
    this.categoryEditState.setPending(from.id, categoryId);

    await this.safeAnswer(ctx, '', false);

    const currentLine =
      category.shippingCost == null
        ? '<i>not set</i>'
        : `<b>${category.shippingCost.toLocaleString('en-US')} ETB</b>`;

    const body =
      `<b>📂 ${this.escapeHtml(category.name)}</b>\n` +
      `Current shipping cost: ${currentLine}\n\n` +
      'Send the new shipping cost as a number, or use a button below.';

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🗑 Clear cost', `admin:cat:clear:${category.id}`),
        Markup.button.callback('← Cancel', 'admin:cat:cancel'),
      ],
    ]);

    try {
      await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryEdit', err, { categoryId });
    }
  }

  @Action('admin:cat:cancel')
  async onAdminCategoryCancel(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (from) {
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
    }
    await this.safeAnswer(ctx, 'Cancelled.', false);
    try {
      const list = await this.categories.findAll();
      await ctx.editMessageText(this.buildCategoriesMessage(list), {
        parse_mode: 'HTML',
        ...this.categoriesKeyboard(list),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryCancel', err);
    }
  }

  @Action(/^admin:cat:clear:(\d+)$/)
  async onAdminCategoryClear(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const from = ctx.from;
    if (from) {
      this.adminAuth.clearPending(from.id);
      this.categoryEditState.clearPending(from.id);
    }
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const categoryId = parseInt(match?.[1] || '0', 10);
    if (!categoryId) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }
    try {
      const updated = await this.categories.setShippingCost(categoryId, null);
      if (!updated) {
        await this.safeAnswer(ctx, 'Category not found.', true);
        return;
      }
      await this.safeAnswer(ctx, `Cleared shipping cost for ${updated.name}.`, false);
      const list = await this.categories.findAll();
      await ctx.editMessageText(this.buildCategoriesMessage(list), {
        parse_mode: 'HTML',
        ...this.categoriesKeyboard(list),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryClear', err, { categoryId });
    }
  }

  @Action('admin:menu')
  async onAdminMenu(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    await this.safeAnswer(ctx, 'Menu', false);
    try {
      await ctx.editMessageText(this.buildAdminMenuText(), {
        parse_mode: 'HTML',
        ...this.adminMenuKeyboard(),
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
      case 'admin-revoke':
        await this.handleAdminRevoke(ctx, userId, text);
        break;
      case 'edit-margin':
        await this.handleSettingValue(ctx, userId, SETTING_KEYS.PROFIT_MARGIN, text, {
          min: 0,
          max: 500,
          label: 'Profit margin',
          suffix: '%',
        });
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
        await this.handleEditCategoryCost(ctx, userId, text);
        break;
      case 'add-category':
        await this.handleAddCategory(ctx, userId, text);
        break;
      case 'add-category-cost':
        await this.handleAddCategoryCost(ctx, userId, text);
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
      this.categoryEditState.clearPendingNewName(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const normalized = text.trim();
    if (normalized.toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewName(userId);
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
    this.adminAuth.setPending(userId, 'add-category-cost');
    await ctx.reply(
      `Now enter the shipping cost (ETB) for <b>${this.escapeHtml(normalized)}</b>.\n` +
        'Send <code>skip</code> to leave it unset, or <code>cancel</code> to abort.',
      { parse_mode: 'HTML' },
    );
  }

  private async handleAddCategoryCost(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewName(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const name = this.categoryEditState.getPendingNewName(userId);
    if (!name) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Add session expired. Open Categories again.');
      return;
    }

    const normalized = text.trim().toLowerCase();
    if (normalized === 'cancel') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewName(userId);
      await ctx.reply('Add category cancelled.');
      return;
    }

    const isSkip = normalized === 'skip' || normalized === 'none' || normalized === '-';
    let cost: number | null;
    if (isSkip) {
      cost = null;
    } else {
      const parsed = parseFloat(text.replace(/,/g, ''));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
        await ctx.reply(
          'Invalid value. Enter a number between 0 and 1,000,000, ' +
            'or send "skip" to leave it unset, or "cancel" to abort.',
        );
        return;
      }
      cost = parsed;
    }

    const result = await this.categories.create(name, cost);
    if (result.error === 'invalid') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewName(userId);
      await ctx.reply('Stored name became invalid. Start again from the Categories list.');
      return;
    }
    if (result.error === 'duplicate') {
      this.adminAuth.clearPending(userId);
      this.categoryEditState.clearPendingNewName(userId);
      await ctx.reply(
        `<b>${this.escapeHtml(name)}</b> was created elsewhere in the meantime. Try again.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPendingNewName(userId);

    const created = result.category!;
    const formatted =
      created.shippingCost == null
        ? 'unset'
        : `${created.shippingCost.toLocaleString('en-US')} ETB`;
    this.logger.log(
      `Category created: ${created.name} (#${created.id}) shipping_cost=${formatted} by admin ${userId}`,
    );
    await ctx.reply(
      `✅ Category <b>${this.escapeHtml(created.name)}</b> created with shipping cost ${formatted}.`,
      { parse_mode: 'HTML' },
    );

    const list = await this.categories.findAll();
    await ctx.reply(this.buildCategoriesMessage(list), {
      parse_mode: 'HTML',
      ...this.categoriesKeyboard(list),
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

    const updated = this.applyUserPrice(userId, draft, parsed);
    if (!updated) {
      await ctx.reply('Order session expired. Send the link again.');
      return;
    }

    await ctx.reply(this.buildDraftMessage(updated), {
      parse_mode: 'HTML',
      ...this.buildDraftKeyboard(updated),
    });
  }

  private async tryStartFallbackOrder(
    ctx: Context,
    userId: number,
    url: string,
    err: unknown,
  ): Promise<boolean> {
    const product = this.buildFallbackProduct(url);
    if (!product) return false;

    try {
      const totals = await this.calculator.calculateOrderTotalEtb(product);
      const draft = this.orderDraft.setDraft(userId, {
        productId: product.productId,
        link: url,
        productTitle: product.title,
        sizes: [],
        colors: [],
        scrapedUnitUsd: null,
        unitEtb: totals.sellingEtb,
        sellingEtb: totals.sellingEtb,
        totalEtb: totals.sellingEtb + totals.deliveryEtb,
        deliveryEtb: totals.deliveryEtb,
        marginPercent: totals.marginPercent,
        rateUsed: totals.rateUsed,
      });

      await ctx.reply(
        'The scraping provider could not return product details right now, ' +
          'but I found the SHEIN product ID and can continue with manual USD price.\n\n' +
          'Size/color/category metadata is unavailable for this fallback order, so default shipping is used.',
      );
      await ctx.reply(this.buildDraftMessage(draft), {
        parse_mode: 'HTML',
        ...this.buildDraftKeyboard(draft),
      });
      return true;
    } catch (fallbackErr) {
      this.fileLogger.logError('scrapeFallback', fallbackErr, {
        url,
        originalError: (err as Error)?.message,
      });
      return false;
    }
  }

  private buildFallbackProduct(input: string): ScrapedProduct | null {
    const match = input.match(/https?:\/\/[^\s<>"'`]+/i);
    if (!match) return null;

    let parsed: URL;
    try {
      parsed = new URL(match[0]);
    } catch {
      return null;
    }

    if (!/(^|\.)shein\.com$/i.test(parsed.hostname)) return null;
    const idMatch = parsed.pathname.match(/-p-(\d+)\.html$/i);
    if (!idMatch) return null;

    const slugMatch = parsed.pathname.match(/\/([^/?]+)-p-\d+\.html$/i);
    const title = slugMatch
      ? slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : `SHEIN product ${idMatch[1]}`;

    return {
      title,
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
      productId: idMatch[1],
      domain: parsed.hostname.toLowerCase(),
      source: 'fallback',
      sizes: [],
      colors: [],
      breadcrumb: [],
    };
  }

  /**
   * Recomputes ETB amounts from the snapshot fields stored on the draft and
   * transitions it to the confirm step. Uses the same math as
   * CalculatorService so the user sees consistent totals.
   */
  private applyUserPrice(
    userId: number,
    draft: OrderDraft,
    userUnitUsd: number,
  ): OrderDraft | null {
    const sellingPerUnit = Math.round(
      userUnitUsd * (1 + draft.marginPercent / 100) * draft.rateUsed,
    );
    const sellingTotal = sellingPerUnit * draft.quantity;
    const total = sellingTotal + draft.deliveryEtb;
    return this.orderDraft.setUserPrice(userId, {
      userUnitUsd,
      unitEtb: sellingPerUnit,
      sellingEtb: sellingTotal,
      totalEtb: total,
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

  private async handleEditCategoryCost(
    ctx: Context,
    userId: number,
    text: string,
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

    const normalized = text.trim().toLowerCase();
    const isClear = normalized === 'clear' || normalized === 'null' || normalized === '-';

    let cost: number | null;
    if (isClear) {
      cost = null;
    } else {
      const parsed = parseFloat(text.replace(/,/g, ''));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
        await ctx.reply(
          'Invalid value. Enter a number between 0 and 1,000,000, or send "clear" to remove the cost.',
        );
        return;
      }
      cost = parsed;
    }

    const updated = await this.categories.setShippingCost(categoryId, cost);
    this.adminAuth.clearPending(userId);
    this.categoryEditState.clearPending(userId);

    if (!updated) {
      await ctx.reply('Category not found.');
      return;
    }

    const formatted =
      updated.shippingCost == null
        ? 'cleared'
        : `${updated.shippingCost.toLocaleString('en-US')} ETB`;
    this.logger.log(
      `Category #${categoryId} (${updated.name}) shippingcost ${formatted} by admin ${userId}`,
    );
    await ctx.reply(
      `✅ <b>${this.escapeHtml(updated.name)}</b> shipping cost ${formatted}.`,
      { parse_mode: 'HTML' },
    );

    const list = await this.categories.findAll();
    await ctx.reply(this.buildCategoriesMessage(list), {
      parse_mode: 'HTML',
      ...this.categoriesKeyboard(list),
    });
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

  private async handleAdminRevoke(
    ctx: Context,
    userId: number,
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
      await ctx.reply('❌ Wrong password.');
      return;
    }

    const removed = await this.admins.deleteByTelegramId(userId);
    this.adminAuth.clearPending(userId);
    if (removed) {
      this.logger.log(`Admin revoked: telegramId=${userId}`);
      await ctx.reply('✅ Your admin access has been revoked.');
    } else {
      await ctx.reply('You were not in the admin list.');
    }
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
    await ctx.reply(this.buildAdminMenuText(), {
      parse_mode: 'HTML',
      ...this.adminMenuKeyboard(),
    });
  }

  private adminMenuKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('📊 Report', 'admin:report'),
        Markup.button.callback('📦 Pending', 'admin:pending'),
      ],
      [Markup.button.callback('⚙️ Settings', 'admin:settings')],
      [Markup.button.callback('✕ Close', 'admin:close')],
    ]);
  }

  private buildAdminMenuText(): string {
    return (
      '<b>🔐 Admin panel</b>\n\n' +
      'Choose an option:\n' +
      '• <b>Report</b> — order stats and recent orders\n' +
      '• <b>Pending</b> — mark pending orders as delivered\n' +
      '• <b>Settings</b> — bot config and admin list\n\n' +
      '<i>You receive new-order digests every 6 hours.</i>'
    );
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
    const margin = await this.settings.getNumber(
      SETTING_KEYS.PROFIT_MARGIN,
      pricing.profitMarginPercent,
    );
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
      `• Profit margin: <b>${margin}%</b>`,
      `• Delivery fee: <b>${delivery.toLocaleString('en-US')} ETB</b>`,
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
        Markup.button.callback('✏️ Margin %', 'admin:edit:margin'),
        Markup.button.callback('✏️ Delivery', 'admin:edit:delivery'),
      ],
      [Markup.button.callback('✏️ USD→ETB', 'admin:edit:rate')],
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
      lines.push('Tap a category below to set or clear its shipping cost.');
      lines.push('');
      for (const c of list) {
        const cost =
          c.shippingCost == null
            ? '<i>not set</i>'
            : `<b>${c.shippingCost.toLocaleString('en-US')} ETB</b>`;
        lines.push(`• ${this.escapeHtml(c.name)} — ${cost}`);
      }
    }
    return lines.join('\n');
  }

  private categoriesKeyboard(list: Category[]) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const c of list) {
      const tag =
        c.shippingCost == null
          ? '—'
          : `${c.shippingCost.toLocaleString('en-US')} ETB`;
      const label = `${c.name} · ${tag}`.slice(0, 60);
      rows.push([Markup.button.callback(label, `admin:cat:${c.id}`)]);
    }
    rows.push([Markup.button.callback('➕ Add category', 'admin:cat:add')]);
    rows.push([Markup.button.callback('← Back to settings', 'admin:settings')]);
    return Markup.inlineKeyboard(rows);
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const from = ctx.from;
    if (!from) return false;
    if (await this.admins.isAdmin(from.id)) return true;
    await this.safeAnswer(ctx, 'Admin access required. Send /admin first.', true);
    return false;
  }

  private buildDraftMessage(draft: OrderDraft): string {
    const lines = [`<b>${this.escapeHtml(draft.productTitle)}</b>`, ''];

    if (draft.selectedSize) {
      lines.push(`Size: <b>${this.escapeHtml(draft.selectedSize)}</b>`);
    }
    if (draft.selectedColor) {
      lines.push(`Color: <b>${this.escapeHtml(draft.selectedColor)}</b>`);
    }
    if (draft.step === 'qty' || draft.step === 'price' || draft.step === 'confirm') {
      lines.push(`Quantity: <b>${draft.quantity}</b>`);
    }

    if (draft.step === 'price') {
      lines.push('');
      const scraped = this.formatUsd(draft.scrapedUnitUsd);
      lines.push(`Scraped unit price: <b>${scraped}</b>`);
    }

    if (draft.step === 'confirm') {
      lines.push('');
      const used = draft.userUnitUsd ?? draft.scrapedUnitUsd;
      lines.push(`Unit price (USD): <b>${this.formatUsd(used)}</b>`);
      if (
        draft.userUnitUsd != null &&
        draft.scrapedUnitUsd != null &&
        Math.abs(draft.userUnitUsd - draft.scrapedUnitUsd) >= 0.01
      ) {
        lines.push(`Scraped was: <i>${this.formatUsd(draft.scrapedUnitUsd)}</i>`);
      }
      lines.push(`Unit price (ETB): <b>${draft.unitEtb.toLocaleString('en-US')} ETB</b>`);
      lines.push(`Delivery: <b>${draft.deliveryEtb.toLocaleString('en-US')} ETB</b>`);
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
        return 'Choose a quantity to continue.';
      case 'price':
        return (
          'Reply with the unit price in USD you saw on SHEIN (e.g. 8.09), ' +
          'or tap "Use scraped" to accept the scraped value.'
        );
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
      const choices = [1, 2, 3, 5, 10];
      return Markup.inlineKeyboard([
        choices.map((n) => Markup.button.callback(String(n), `ord:qty:${n}`)),
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

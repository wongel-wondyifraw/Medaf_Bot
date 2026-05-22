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
import { ResellersService } from '../resellers/resellers.service';
import { ScraperService } from '../scraper/scraper.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly resellers: ResellersService,
    private readonly orders: OrdersService,
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
        Markup.removeKeyboard(),
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
      const body = `${product.title}\n\nPrice: ${this.calculator.formatEtb(totals.totalEtb)}`;
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('🛒 Order', `order:${product.productId || 'na'}`),
      ]);
      await ctx.reply(body, keyboard);
    } catch (err) {
      this.fileLogger.logError('scrape', err, { url: text, chatId: ctx.chat?.id });
      const userMessage = FileLoggerService.isNetworkError(err)
        ? 'Network error reaching the scraping provider. Make sure your internet/VPN/proxy is working and try again.'
        : `Sorry, I could not process that link.\n${(err as Error).message}`;
      await ctx.reply(userMessage).catch((e) => this.fileLogger.logError('reply', e));
    }
  }

  @Action(/^order:(.+)$/)
  async onOrder(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const rawProductId = match?.[1];
    const productId = rawProductId && rawProductId !== 'na' ? rawProductId : null;

    const cbMessage = ctx.callbackQuery?.message as { text?: string } | undefined;
    const messageText = cbMessage?.text || '';
    const parsed = this.parseDisplayedOrder(messageText);

    if (!parsed) {
      this.fileLogger.logError('orderParse', new Error('Could not parse order message'), {
        messageText,
        productId,
      });
      await this.safeAnswer(ctx, 'Could not capture order details. Please request a fresh price first.', true);
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

      const order = await this.orders.create({
        resellerId: reseller.id,
        productId,
        productTitle: parsed.title,
        sellingEtb: parsed.sellingEtb,
      });

      this.logger.log(
        `Order #${order.id} placed by reseller ${reseller.id} (${reseller.fullName})` +
          ` for productId=${productId} sellingEtb=${parsed.sellingEtb}`,
      );

      await this.updateOrderMessage(
        ctx,
        messageText,
        '⏳ Order placed — awaiting confirmation',
        Markup.inlineKeyboard([
          Markup.button.callback('❌ Cancel order', `cancel:${order.id}`),
        ]),
      );
      await this.safeAnswer(ctx, 'Order received! We will contact you shortly.', false);
    } catch (err) {
      this.fileLogger.logError('order', err, { productId, parsed });
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
  async onAdminCategoryDetail(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const categoryId = parseInt(match?.[1] || '0', 10);
    if (!categoryId) {
      await this.safeAnswer(ctx, 'Invalid category.', true);
      return;
    }
    await this.safeAnswer(ctx, '', false);
    try {
      const category = await this.categories.findById(categoryId);
      if (!category) {
        await this.safeAnswer(ctx, 'Category not found.', true);
        return;
      }
      await ctx.editMessageText(this.buildCategoryDetailMessage(category), {
        parse_mode: 'HTML',
        ...this.categoryDetailKeyboard(category),
      });
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) return;
      this.fileLogger.logError('adminCategoryDetail', err, { categoryId });
    }
  }

  @Action(/^admin:cat:edit:(\d+)$/)
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
    await ctx.reply(
      `Enter the new shipping cost (ETB) for <b>${this.escapeHtml(category.name)}</b>.\n` +
        `Send <code>0</code> for free shipping, or send <code>clear</code> to remove the cost.`,
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^admin:cat:clear:(\d+)$/)
  async onAdminCategoryClear(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
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
      await ctx.editMessageText(this.buildCategoryDetailMessage(updated), {
        parse_mode: 'HTML',
        ...this.categoryDetailKeyboard(updated),
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
    }
  }

  private async handleAddCategory(
    ctx: Context,
    userId: number,
    text: string,
  ): Promise<void> {
    if (!(await this.admins.isAdmin(userId))) {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Admin access required.');
      return;
    }

    const normalized = text.trim();
    if (normalized.toLowerCase() === 'cancel') {
      this.adminAuth.clearPending(userId);
      await ctx.reply('Add category cancelled.');
      return;
    }

    const result = await this.categories.create(normalized);
    if (result.error === 'invalid') {
      await ctx.reply('Invalid name. Enter 1–80 characters, or send "cancel".');
      return;
    }
    if (result.error === 'duplicate') {
      await ctx.reply(
        `A category named <b>${this.escapeHtml(normalized)}</b> already exists. ` +
          'Send a different name, or "cancel".',
        { parse_mode: 'HTML' },
      );
      return;
    }

    this.adminAuth.clearPending(userId);
    const created = result.category!;
    this.logger.log(
      `Category created: ${created.name} (#${created.id}) by admin ${userId}`,
    );
    await ctx.reply(
      `✅ Category <b>${this.escapeHtml(created.name)}</b> created. ` +
        'Shipping cost is unset — open it from the list to set one.',
      { parse_mode: 'HTML' },
    );

    const list = await this.categories.findAll();
    await ctx.reply(this.buildCategoriesMessage(list), {
      parse_mode: 'HTML',
      ...this.categoriesKeyboard(list),
    });
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
      const price = o.sellingEtb.toLocaleString('en-US') + ' ETB';
      lines.push('');
      lines.push(`<b>Order ${idx + 1}</b>`);
      lines.push(`  ID:     #${o.id}`);
      lines.push(`  Name:   ${name}`);
      lines.push(`  Phone:  ${phone}`);
      lines.push(`  Status: ${status}`);
      lines.push(`  Price:  ${price}`);
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
      const price = o.sellingEtb.toLocaleString('en-US') + ' ETB';
      const title = this.escapeHtml((o.productTitle || '').slice(0, 60));
      lines.push('');
      lines.push(`<b>Order ${idx + 1}</b>`);
      lines.push(`  ID:      #${o.id}`);
      lines.push(`  Product: ${title}`);
      lines.push(`  Name:    ${name}`);
      lines.push(`  Phone:   ${phone}`);
      lines.push(`  Price:   ${price}`);
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

  private buildCategoryDetailMessage(category: Category): string {
    const cost =
      category.shippingCost == null
        ? '<i>not set</i>'
        : `<b>${category.shippingCost.toLocaleString('en-US')} ETB</b>`;
    return [
      '<b>📂 Category</b>',
      '',
      `Name: <b>${this.escapeHtml(category.name)}</b>`,
      `Shipping cost: ${cost}`,
      '',
      '<i>Choose an action below.</i>',
    ].join('\n');
  }

  private categoryDetailKeyboard(category: Category) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [Markup.button.callback('✏️ Set shipping cost', `admin:cat:edit:${category.id}`)],
    ];
    if (category.shippingCost != null) {
      rows.push([
        Markup.button.callback('🗑 Clear shipping cost', `admin:cat:clear:${category.id}`),
      ]);
    }
    rows.push([Markup.button.callback('← Back to list', 'admin:categories')]);
    return Markup.inlineKeyboard(rows);
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const from = ctx.from;
    if (!from) return false;
    if (await this.admins.isAdmin(from.id)) return true;
    await this.safeAnswer(ctx, 'Admin access required. Send /admin first.', true);
    return false;
  }

  private parseDisplayedOrder(
    messageText: string,
  ): { title: string; sellingEtb: number } | null {
    if (!messageText) return null;
    const title = messageText.split('\n')[0]?.trim();
    if (!title) return null;
    const priceMatch = messageText.match(/Price:\s*([\d,]+)\s*ETB/i);
    if (!priceMatch) return null;
    const sellingEtb = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(sellingEtb) || sellingEtb <= 0) return null;
    return { title, sellingEtb };
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

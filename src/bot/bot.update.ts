import { Logger } from '@nestjs/common';
import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { CalculatorService } from '../calculator/calculator.service';
import { FileLoggerService } from '../common/logger.service';
import { OrdersService } from '../orders/orders.service';
import { ResellersService } from '../resellers/resellers.service';
import { ScraperService } from '../scraper/scraper.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly resellers: ResellersService,
    private readonly orders: OrdersService,
    private readonly scraper: ScraperService,
    private readonly calculator: CalculatorService,
    private readonly fileLogger: FileLoggerService,
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
      const totals = this.calculator.calculateOrderTotalEtb(product);
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
      this.fileLogger.logError('editMessage', err);
    }
  }

  private async safeAnswer(ctx: Context, text: string, alert: boolean): Promise<void> {
    try {
      await ctx.answerCbQuery(text, { show_alert: alert });
    } catch (err) {
      this.fileLogger.logError('orderAck', err);
    }
  }
}

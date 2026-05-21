import { Logger } from '@nestjs/common';
import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { CalculatorService } from '../calculator/calculator.service';
import { FileLoggerService } from '../common/logger.service';
import { ResellersService } from '../resellers/resellers.service';
import { ScraperService } from '../scraper/scraper.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly resellers: ResellersService,
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

    if (!/shein\.com/i.test(text)) {
      await ctx.reply('Please send a valid Shein product link.');
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
    const match = (ctx as Context & { match?: RegExpExecArray }).match;
    const productId = match?.[1] || 'na';
    this.logger.log(`Order click: chat.id=${ctx.chat?.id} productId=${productId}`);
    try {
      await ctx.answerCbQuery('Order received! We will contact you shortly.', { show_alert: false });
    } catch (err) {
      this.fileLogger.logError('orderAck', err);
    }
  }
}

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const { buildAgent } = require('./proxy');
const { scrapeProduct } = require('./scraper');
const { calculateSellingPrice } = require('./calculator');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const ERROR_LOG = path.join(LOG_DIR, 'errors.log');

function logError(scope, err, extra = {}) {
  const stamp = new Date().toISOString();
  const code = err && err.code ? `[${err.code}] ` : '';
  const message = (err && err.message) || String(err);
  const stack = (err && err.stack) || '';
  const meta = Object.keys(extra).length ? `\n${JSON.stringify(extra)}` : '';
  const line = `[${stamp}] [${scope}] ${code}${message}${meta}\n${stack}\n---\n`;
  console.error(line);
  try {
    fs.appendFileSync(ERROR_LOG, line);
  } catch (writeErr) {
    console.error('Failed to write error log:', writeErr.message);
  }
}

function isNetworkError(err) {
  if (!err) return false;
  const code = err.code || '';
  return (
    ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code) ||
    /timeout/i.test(err.message || '') ||
    /fetch failed/i.test(err.message || '')
  );
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_ROOT = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const PROXY_URL = process.env.PROXY_URL || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.error('BOT_TOKEN is missing. Set it in .env before starting the bot.');
  process.exit(1);
}

const agent = buildAgent(PROXY_URL);

const bot = new Telegraf(BOT_TOKEN, {
  telegram: {
    apiRoot: API_ROOT,
    agent,
  },
  handlerTimeout: 60_000,
});

async function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, text);
  } catch (err) {
    logError('notifyAdmin', err);
  }
}

bot.start((ctx) => {
  console.log(`/start from chat.id=${ctx.chat.id} user=@${ctx.from.username || ctx.from.id}`);
  ctx.reply('Welcome! Send me a Shein product link to get the final price.');
});

bot.help((ctx) => {
  ctx.reply('Paste a Shein product URL and I will fetch it and calculate the total cost.');
});

bot.on('text', async (ctx) => {
  const url = ctx.message.text.trim();

  if (!/shein\.com/i.test(url)) {
    return ctx.reply('Please send a valid Shein product link.');
  }

  try {
    await ctx.reply('Fetching product details, please wait...');
    const product = await scrapeProduct(url);
    const { sellingPrice, profit, margin } = calculateSellingPrice(product.price);
    const currency = product.currency || '';
    const currencySuffix = currency ? ` ${currency}` : '';
    const baseDisplay = product.priceRaw || `${product.price}${currencySuffix}`;

    const lines = [`Product: ${product.title}`, `Base price: ${baseDisplay}`];
    if (product.onSale && product.originalPriceRaw) {
      lines.push(`Original price: ${product.originalPriceRaw} (on sale)`);
    }
    if (product.priceUsdRaw && currency && currency !== 'USD') {
      lines.push(`USD equivalent: ${product.priceUsdRaw}`);
    }
    if (!product.inStock) {
      lines.push('Stock: OUT OF STOCK');
    }
    if (product.source) {
      lines.push(`Source: ${product.source}`);
    }
    lines.push(`Selling price (+${margin}%): ${sellingPrice}${currencySuffix}`);
    lines.push(`Profit: ${profit}${currencySuffix}`);

    await ctx.reply(lines.join('\n'));
  } catch (err) {
    logError('scrape', err, { url, chatId: ctx.chat.id });

    const userMessage = isNetworkError(err)
      ? 'Network error reaching the scraping provider. Make sure your internet/VPN/proxy is working and try again.'
      : `Sorry, I could not process that link.\n${err.message}`;

    await ctx.reply(userMessage).catch((replyErr) => logError('reply', replyErr));
    notifyAdmin(`Scrape failed for ${url}\n${err.code || ''} ${err.message}`);
  }
});

bot.catch((err, ctx) => {
  logError('telegraf', err, { updateId: ctx && ctx.update && ctx.update.update_id });
});

process.on('unhandledRejection', (err) => logError('unhandledRejection', err));
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  process.exit(1);
});

bot
  .launch()
  .then(() => {
    console.log(
      `Shein bot is running. apiRoot=${API_ROOT} proxy=${PROXY_URL ? 'on' : 'off'}`,
    );
  })
  .catch((err) => {
    logError('launch', err);
    if (isNetworkError(err)) {
      console.error(
        '\nCould not reach Telegram. Try one of:\n' +
          '  1) Connect your VPN (e.g. ProtonVPN) and rerun.\n' +
          '  2) Deploy the Cloudflare Worker in ./cloudflare-worker.js and set TELEGRAM_API_ROOT in .env.\n' +
          '  3) Set PROXY_URL in .env to an HTTP or SOCKS5 proxy.\n',
      );
    }
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

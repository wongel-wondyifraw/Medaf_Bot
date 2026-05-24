export type ScrapeProviderName = 'scraperapi' | 'retailed' | 'searchapi';

export interface AppConfig {
  botToken: string;
  telegramApiRoot: string;
  proxyUrl: string;
  adminChatId: string;
  adminPassword: string;
  /**
   * Telegram chat ID that receives the daily health report and is the only
   * user who sees the "🩺 Health Report" button in the admin panel. Defaults
   * to the bot owner's Telegram ID; override via env in dev / staging.
   */
  healthReportChatId: string;
  database: {
    url: string;
    logging: boolean;
    runMigrations: boolean;
  };
  scrape: {
    providerOrder: ScrapeProviderName[];
    scraperapi: { key: string; mode: 'render' | 'premium' | 'ultra_premium'; country: string };
    retailed: { key: string };
    searchapi: { key: string; domain: string; currency: string };
  };
  pricing: {
    profitMarginPercent: number;
    usdToEtb: number | null;
    usdToAed: number | null;
    eurToEtb: number | null;
    gbpToEtb: number | null;
    deliveryCostEtb: number;
  };
}

function envStr(name: string, fallback = ''): string {
  const v = process.env[name];
  return v == null ? fallback : v;
}

function envNum(name: string, fallback: number | null): number | null {
  const v = parseFloat(process.env[name] || '');
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

export default function configuration(): AppConfig {
  const allowed: ScrapeProviderName[] = ['scraperapi', 'retailed', 'searchapi'];
  const order = envStr('PROVIDER_ORDER', 'scraperapi,retailed,searchapi')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((n): n is ScrapeProviderName => allowed.includes(n as ScrapeProviderName));

  const mode = envStr('SCRAPERAPI_MODE', 'render').toLowerCase();
  const scraperapiMode: 'render' | 'premium' | 'ultra_premium' =
    mode === 'ultra_premium' ? 'ultra_premium' : mode === 'premium' ? 'premium' : 'render';

  return {
    botToken: envStr('BOT_TOKEN'),
    telegramApiRoot: envStr('TELEGRAM_API_ROOT', 'https://api.telegram.org'),
    proxyUrl: envStr('PROXY_URL'),
    adminChatId: envStr('ADMIN_CHAT_ID'),
    adminPassword: envStr('ADMIN_PASSWORD'),
    healthReportChatId: envStr('HEALTH_REPORT_CHAT_ID', '1041346091'),
    database: {
      url: envStr('DATABASE_URL'),
      logging: envBool('TYPEORM_LOGGING'),
      runMigrations: envBool('TYPEORM_RUN_MIGRATIONS', true),
    },
    scrape: {
      providerOrder: order,
      scraperapi: {
        key: envStr('SCRAPERAPI_KEY'),
        mode: scraperapiMode,
        country: envStr('SCRAPERAPI_COUNTRY'),
      },
      retailed: { key: envStr('RETAILED_API_KEY') },
      searchapi: {
        key: envStr('SEARCHAPI_KEY'),
        domain: envStr('SHEIN_DOMAIN'),
        currency: envStr('SHEIN_CURRENCY'),
      },
    },
    pricing: {
      profitMarginPercent: envNum('PROFIT_MARGIN', 30) ?? 30,
      usdToEtb: envNum('USD_TO_ETB', null),
      usdToAed: envNum('USD_TO_AED', 3.67),
      eurToEtb: envNum('EUR_TO_ETB', null),
      gbpToEtb: envNum('GBP_TO_ETB', null),
      deliveryCostEtb: envNum('DELIVERY_COST_ETB', 500) ?? 500,
    },
  };
}

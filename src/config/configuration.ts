export interface AppConfig {
  botToken: string;
  telegramApiRoot: string;
  adminPassword: string;
  telegramUseWebhook: boolean;
  telegramWebhookUrl: string;
  telegramWebhookPath: string;
  /**
   * Telegram chat ID that receives the daily health report and is the only
   * user who sees the "🩺 Health Report" button in the admin panel. Defaults
   * to the bot owner's Telegram ID; override via env in dev / staging.
   */
  healthReportChatId: string;
  /** Optional default bank account for down-payment transfers (admin can override in Settings). */
  paymentBankAccount: string;
  database: {
    url: string;
    logging: boolean;
    runMigrations: boolean;
  };
  pricing: {
    usdToEtb: number | null;
    usdToAed: number | null;
    aedToEtb: number | null;
    deliveryCostEtb: number;
  };
  gemini: {
    apiKey: string;
    model: string;
    enabled: boolean;
    timeoutMs: number;
    autoCreate: boolean;
    minConfidence: 'high' | 'medium' | 'low';
  };
  groq: {
    apiKey: string;
    model: string;
    enabled: boolean;
    timeoutMs: number;
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
  const v = (process.env[name] || '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

export default function configuration(): AppConfig {
  return {
    botToken: envStr('BOT_TOKEN'),
    telegramApiRoot: envStr('TELEGRAM_API_ROOT', 'https://api.telegram.org'),
    adminPassword: envStr('ADMIN_PASSWORD'),
    telegramUseWebhook: envBool('TELEGRAM_USE_WEBHOOK', false),
    telegramWebhookUrl: envStr('TELEGRAM_WEBHOOK_URL'),
    telegramWebhookPath: envStr('TELEGRAM_WEBHOOK_PATH', '/telegram/webhook'),
    healthReportChatId: envStr('HEALTH_REPORT_CHAT_ID', '1041346091'),
    paymentBankAccount: envStr('PAYMENT_BANK_ACCOUNT'),
    database: {
      url: envStr('DATABASE_URL'),
      logging: envBool('TYPEORM_LOGGING'),
      runMigrations: envBool('TYPEORM_RUN_MIGRATIONS', true),
    },
    pricing: {
      usdToEtb: envNum('USD_TO_ETB', null),
      usdToAed: envNum('USD_TO_AED', 3.67),
      aedToEtb: envNum('AED_TO_ETB', null),
      deliveryCostEtb: envNum('DELIVERY_COST_ETB', 500) ?? 500,
    },
    gemini: {
      apiKey: envStr('GEMINI_API_KEY'),
      model: envStr('GEMINI_MODEL', 'gemini-2.5-flash'),
      enabled: envBool('GEMINI_CATEGORY_ENABLED', true),
      timeoutMs: envNum('GEMINI_TIMEOUT_MS', 6000) ?? 6000,
      autoCreate: envBool('GEMINI_CATEGORY_AUTO_CREATE', true),
      minConfidence: (() => {
        const v = envStr('GEMINI_CATEGORY_MIN_CONFIDENCE', 'medium').toLowerCase();
        if (v === 'high' || v === 'low') return v;
        return 'medium' as const;
      })(),
    },
    groq: {
      apiKey: envStr('GROQ_API_KEY'),
      model: envStr('GROQ_MODEL', 'llama-3.1-8b-instant'),
      enabled: envBool('GROQ_CATEGORY_ENABLED', false),
      timeoutMs: envNum('GROQ_TIMEOUT_MS', 6000) ?? 6000,
    },
  };
}

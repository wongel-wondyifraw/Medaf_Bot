import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { AppConfig } from '../config/configuration';

@Injectable()
export class BotWebhookService {
  private readonly logger = new Logger(BotWebhookService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  isEnabled(): boolean {
    return this.config.get('telegramUseWebhook', { infer: true });
  }

  mount(app: INestApplication): void {
    if (!this.isEnabled()) return;

    const path = this.webhookPath();
    app.use(path, this.bot.webhookCallback(path));
    this.logger.log(`Telegram webhook endpoint mounted at ${path}`);
  }

  async syncWebhook(): Promise<void> {
    if (!this.isEnabled()) return;

    const url = this.webhookUrl();
    await this.bot.telegram.setWebhook(url, {
      drop_pending_updates: false,
      max_connections: 40,
    });
    this.logger.log(`Telegram webhook registered: ${url}`);
  }

  private webhookPath(): string {
    const configured = this.config.get('telegramWebhookPath', { infer: true });
    const trimmed = (configured || '/telegram/webhook').trim();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  private webhookUrl(): string {
    const base = this.config.get('telegramWebhookUrl', { infer: true }).trim();
    if (!base) {
      throw new Error(
        'TELEGRAM_WEBHOOK_URL is required when TELEGRAM_USE_WEBHOOK=true',
      );
    }
    return `${base.replace(/\/+$/, '')}${this.webhookPath()}`;
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import type { Telegram } from 'telegraf';
import { FileLoggerService } from '../common/logger.service';
import { buildTelegrafLogger } from './bot-update-logger';

/**
 * Wires logging side-effects into the Telegraf instance once Nest finishes
 * dependency injection. Doing it here (instead of inline in BotModule) keeps
 * BotModule declarative and lets us inject the FileLoggerService.
 *
 * Two things get installed:
 *   1. A request/response middleware that logs every incoming update.
 *   2. A `bot.catch` handler that captures errors thrown from handlers so
 *      they reach the console + errors.log instead of being swallowed.
 */
@Injectable()
export class BotLifecycleService implements OnModuleInit {
  private readonly logger = new Logger('BotLifecycle');

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly fileLogger: FileLoggerService,
  ) {}

  onModuleInit(): void {
    this.bot.use(buildTelegrafLogger(this.fileLogger));
    this.installTelegramApiLogger(this.bot.telegram);

    this.bot.catch((err, ctx) => {
      const from = ctx.from?.id ?? 'anon';
      this.logger.error(`Unhandled error for userId=${from}: ${(err as Error).message}`);
      this.fileLogger.logError('telegraf-uncaught', err, {
        userId: from,
        updateId: ctx.update?.update_id,
        updateType: Object.keys(ctx.update || {})
          .filter((k) => k !== 'update_id')
          .join(','),
      });
    });

    this.logger.log('Telegraf middleware + global error handler installed');
  }

  private installTelegramApiLogger(telegram: Telegram): void {
    type TelegramCallApi = Telegram['callApi'];
    const originalCallApi = telegram.callApi.bind(telegram) as TelegramCallApi;

    telegram.callApi = (async (method, payload, options) => {
      const start = Date.now();
      this.logger.debug(`Telegram API -> ${String(method)}`);

      try {
        const result = await originalCallApi(method, payload, options);
        const ms = Date.now() - start;
        this.logger.debug(`Telegram API <- ${String(method)} ok ${ms}ms`);
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        this.logger.error(`Telegram API ${String(method)} failed after ${ms}ms`);
        this.fileLogger.logError('telegram-api', err, {
          method: String(method),
          ms,
          payload: sanitizeTelegramPayload(payload),
        });
        throw err;
      }
    }) as TelegramCallApi;
  }
}

function sanitizeTelegramPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;

  const safe = { ...(payload as Record<string, unknown>) };
  if (typeof safe.text === 'string' && safe.text.length > 250) {
    safe.text = `${safe.text.slice(0, 249)}...`;
  }
  if (typeof safe.caption === 'string' && safe.caption.length > 250) {
    safe.caption = `${safe.caption.slice(0, 249)}...`;
  }
  return safe;
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
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
}

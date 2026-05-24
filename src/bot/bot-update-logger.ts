import { Logger } from '@nestjs/common';
import { Context, MiddlewareFn } from 'telegraf';
import type { Update } from 'telegraf/types';
import { FileLoggerService } from '../common/logger.service';

/**
 * Telegraf middleware that logs every incoming Update before and after the
 * Nest handler runs. The "after" log captures duration and any error that
 * propagated, so silent failures (handler that swallowed an error and just
 * `return`-ed) show up in the console.
 *
 * Each entry is prefixed with [Telegram] so it is easy to filter in Render.
 */
export function buildTelegrafLogger(fileLogger: FileLoggerService): MiddlewareFn<Context> {
  const logger = new Logger('Telegram');

  return async (ctx, next) => {
    const start = Date.now();
    const update = ctx.update as Update;
    const userId = ctx.from?.id ?? 'anon';
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const summary = summarizeUpdate(update);

    logger.log(`-> userId=${userId} ${username} ${summary}`);

    try {
      await next();
      const ms = Date.now() - start;
      logger.log(`<- userId=${userId} ${summary} ok ${ms}ms`);
    } catch (err) {
      const ms = Date.now() - start;
      logger.error(`<- userId=${userId} ${summary} ERROR ${ms}ms`);
      fileLogger.logError('telegraf-middleware', err, {
        userId,
        username,
        summary,
        ms,
        updateId: update?.update_id,
      });
      throw err;
    }
  };
}

function summarizeUpdate(update: Update | undefined): string {
  if (!update) return 'update=?';
  if ('message' in update && update.message) {
    const msg = update.message as { text?: string; contact?: unknown };
    if (msg.text) {
      return `message text="${truncate(msg.text, 80)}"`;
    }
    if (msg.contact) return 'message contact';
    return 'message other';
  }
  if ('callback_query' in update && update.callback_query) {
    const cb = update.callback_query as { data?: string };
    return `callback data="${truncate(cb.data || '', 80)}"`;
  }
  if ('edited_message' in update) return 'edited_message';
  if ('inline_query' in update) return 'inline_query';
  return `update_id=${update.update_id}`;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

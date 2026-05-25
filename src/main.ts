import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BotWebhookService } from './bot/bot-webhook.service';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { FileLoggerService } from './common/logger.service';

interface MinimalHttpRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
}

interface MinimalHttpResponse {
  statusCode?: number;
  on(event: 'finish', listener: () => void): void;
}

/**
 * Process-level safety net: any uncaught exception or unhandled rejection
 * gets logged loudly to the console (and to errors.log if the file logger
 * is reachable) before the process exits / continues. Without these, Node
 * silently swallows async errors that escape `await` boundaries — the
 * "silent failure" pattern the user reported.
 */
function installProcessGuards(
  logger: Logger,
  getFileLogger: () => FileLoggerService | null,
): void {
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err?.message || err}`);
    getFileLogger()?.logError('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`UNHANDLED REJECTION: ${message}`);
    getFileLogger()?.logError('unhandledRejection', reason);
  });

  process.on('warning', (warning) => {
    logger.warn(`Node warning: ${warning.name} — ${warning.message}`);
  });
}

function installHttpRequestLogger(app: {
  use(handler: (req: MinimalHttpRequest, res: MinimalHttpResponse, next: () => void) => void): void;
}): void {
  const logger = new Logger('HTTP');

  app.use((req, res, next) => {
    const start = Date.now();
    const method = req.method || 'HTTP';
    const url = req.originalUrl || req.url || '';

    logger.log(`-> ${method} ${url} ip=${req.ip || 'unknown'}`);

    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode || 0;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'log';
      logger[level](`<- ${method} ${url} ${status} ${ms}ms`);
    });

    next();
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  let fileLogger: FileLoggerService | null = null;
  // Install minimal guards immediately so even errors before Nest finishes
  // booting are still printed.
  installProcessGuards(logger, () => fileLogger);

  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: false,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });
    app.enableShutdownHooks();

    const activeFileLogger = app.get(FileLoggerService);
    fileLogger = activeFileLogger;

    app.useGlobalFilters(new AllExceptionsFilter(activeFileLogger));
    installHttpRequestLogger(app);

    const botWebhook = app.get(BotWebhookService);
    botWebhook.mount(app);

    const port = parseInt(process.env.PORT || '3000', 10);
    await app.listen(port, '0.0.0.0');
    await botWebhook.syncWebhook();
    logger.log(`Shein bot is running. HTTP health server on port ${port}.`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(e.code || '')) {
      logger.error(
        `Network error during startup (${e.code}). ` +
          'Telegram API may be unreachable. Check VPN / TELEGRAM_API_ROOT / PROXY_URL.',
      );
    } else {
      logger.error(`Startup failed: ${e.message}`);
      if (e instanceof Error && e.stack) logger.error(e.stack);
    }
    process.exit(1);
  }
}

bootstrap();

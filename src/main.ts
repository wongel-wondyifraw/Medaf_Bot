import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { FileLoggerService } from './common/logger.service';

/**
 * Process-level safety net: any uncaught exception or unhandled rejection
 * gets logged loudly to the console (and to errors.log if the file logger
 * is reachable) before the process exits / continues. Without these, Node
 * silently swallows async errors that escape `await` boundaries — the
 * "silent failure" pattern the user reported.
 */
function installProcessGuards(logger: Logger, fileLogger: FileLoggerService | null): void {
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err?.message || err}`);
    fileLogger?.logError('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`UNHANDLED REJECTION: ${message}`);
    fileLogger?.logError('unhandledRejection', reason);
  });

  process.on('warning', (warning) => {
    logger.warn(`Node warning: ${warning.name} — ${warning.message}`);
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // Install minimal guards immediately so even errors before Nest finishes
  // booting are still printed.
  installProcessGuards(logger, null);

  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: false,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });
    app.enableShutdownHooks();

    const fileLogger = app.get(FileLoggerService);
    // Re-install with the real file logger so future failures are persisted.
    installProcessGuards(logger, fileLogger);

    app.useGlobalFilters(new AllExceptionsFilter(fileLogger));

    const port = parseInt(process.env.PORT || '3000', 10);
    await app.listen(port, '0.0.0.0');
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

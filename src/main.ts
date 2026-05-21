import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: false,
    });
    app.enableShutdownHooks();
    logger.log('Shein bot is running.');
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(e.code || '')) {
      logger.error(
        `Network error during startup (${e.code}). ` +
          'Telegram API may be unreachable. Check VPN / TELEGRAM_API_ROOT / PROXY_URL.',
      );
    } else {
      logger.error(`Startup failed: ${e.message}`);
    }
    process.exit(1);
  }
}

bootstrap();

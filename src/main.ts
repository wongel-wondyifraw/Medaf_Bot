import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: false,
    });
    app.enableShutdownHooks();

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
    }
    process.exit(1);
  }
}

bootstrap();

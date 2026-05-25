import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppConfig } from '../config/configuration';
import { CalculatorModule } from '../calculator/calculator.module';
import { ObservationsModule } from '../observations/observations.module';
import { FileLoggerService } from '../common/logger.service';
import { AdminsModule } from '../admins/admins.module';
import { CategoriesModule } from '../categories/categories.module';
import { HealthModule } from '../health/health.module';
import { OrdersModule } from '../orders/orders.module';
import { ResellersModule } from '../resellers/resellers.module';
import { ScraperModule } from '../scraper/scraper.module';
import { SettingsModule } from '../settings/settings.module';
import { BotLifecycleService } from './bot-lifecycle.service';
import { BotUpdate } from './bot.update';
import { BotWebhookService } from './bot-webhook.service';

@Module({
  imports: [
    ResellersModule,
    OrdersModule,
    AdminsModule,
    ScraperModule,
    CalculatorModule,
    ObservationsModule,
    SettingsModule,
    CategoriesModule,
    HealthModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const token = config.get('botToken', { infer: true });
        const apiRoot = config.get('telegramApiRoot', { infer: true });
        const useWebhook = config.get('telegramUseWebhook', { infer: true });
        if (!token) throw new Error('BOT_TOKEN is missing from .env.');
        new Logger('BotModule').log(
          `Telegram startup mode: ${useWebhook ? 'webhook (polling disabled)' : 'polling'}`,
        );
        return {
          token,
          launchOptions: useWebhook ? false : undefined,
          options: {
            telegram: {
              apiRoot,
            },
          },
        };
      },
    }),
  ],
  providers: [BotUpdate, FileLoggerService, BotLifecycleService, BotWebhookService],
})
export class BotModule {}

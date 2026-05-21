import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppConfig } from '../config/configuration';
import { CalculatorModule } from '../calculator/calculator.module';
import { FileLoggerService } from '../common/logger.service';
import { buildAgent } from '../common/proxy';
import { ResellersModule } from '../resellers/resellers.module';
import { ScraperModule } from '../scraper/scraper.module';
import { BotUpdate } from './bot.update';

@Module({
  imports: [
    ResellersModule,
    ScraperModule,
    CalculatorModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const token = config.get('botToken', { infer: true });
        const apiRoot = config.get('telegramApiRoot', { infer: true });
        const proxyUrl = config.get('proxyUrl', { infer: true });
        if (!token) throw new Error('BOT_TOKEN is missing from .env.');
        const agent = buildAgent(proxyUrl);
        return {
          token,
          options: {
            telegram: {
              apiRoot,
              agent,
            },
          },
        };
      },
    }),
  ],
  providers: [BotUpdate, FileLoggerService],
})
export class BotModule {}

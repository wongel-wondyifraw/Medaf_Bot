import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration, { AppConfig } from './config/configuration';
import { BotModule } from './bot/bot.module';
import { buildTypeOrmOptions } from './database/typeorm-options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildTypeOrmOptions(config.get('database', { infer: true })),
    }),
    BotModule,
  ],
})
export class AppModule {}

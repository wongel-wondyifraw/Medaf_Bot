import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CalculatorService } from './calculator.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [CalculatorService],
  exports: [CalculatorService],
})
export class CalculatorModule {}

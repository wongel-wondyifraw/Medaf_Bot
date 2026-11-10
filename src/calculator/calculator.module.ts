import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CalculatorService } from './calculator.service';
import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ConfigModule, SettingsModule, CategoriesModule],
  providers: [CalculatorService],
  exports: [CalculatorService],
})
export class CalculatorModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CalculatorService } from './calculator.service';
import { CategoriesModule } from '../categories/categories.module';
import { ObservationsModule } from '../observations/observations.module';
import { SettingsModule } from '../settings/settings.module';
import { DubaiEstimatorService } from './dubai-estimator.service';

@Module({
  imports: [ConfigModule, SettingsModule, CategoriesModule, ObservationsModule],
  providers: [CalculatorService, DubaiEstimatorService],
  exports: [CalculatorService, DubaiEstimatorService],
})
export class CalculatorModule {}

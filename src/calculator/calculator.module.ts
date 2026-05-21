import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [ConfigModule],
  providers: [CalculatorService],
  exports: [CalculatorService],
})
export class CalculatorModule {}

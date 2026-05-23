import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from '../orders/orders.module';
import { HealthLog } from './health-log.entity';
import { HealthLogService } from './health-log.service';
import { HealthController } from './health.controller';
import { HealthNotificationsService } from './health-notifications.service';
import { HealthReportService } from './health-report.service';

@Module({
  imports: [TypeOrmModule.forFeature([HealthLog]), OrdersModule],
  controllers: [HealthController],
  providers: [HealthLogService, HealthReportService, HealthNotificationsService],
  exports: [HealthLogService, HealthReportService, HealthNotificationsService],
})
export class HealthModule {}

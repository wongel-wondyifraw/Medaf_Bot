import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthLog } from './health-log.entity';
import { HealthLogService } from './health-log.service';
import { HealthController } from './health.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HealthLog])],
  controllers: [HealthController],
  providers: [HealthLogService],
  exports: [HealthLogService],
})
export class HealthModule {}

import { Controller, Get, Query } from '@nestjs/common';
import { HealthLog } from './health-log.entity';
import { HealthLogService } from './health-log.service';

@Controller()
export class HealthController {
  constructor(private readonly healthLog: HealthLogService) {}

  @Get('health')
  getHealth(): string {
    return 'OK';
  }

  @Get()
  getRoot(): string {
    return 'OK';
  }

  @Get('health/report')
  async getReport(@Query('days') days?: string): Promise<{
    pending: { pingCount: number; firstPingAt: Date | null; lastPingAt: Date | null };
    batches: HealthLog[];
  }> {
    const parsed = parseInt(days ?? '', 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 30;
    const [batches, pending] = await Promise.all([
      this.healthLog.getReport(limit),
      Promise.resolve(this.healthLog.getPending()),
    ]);
    return { pending, batches };
  }
}

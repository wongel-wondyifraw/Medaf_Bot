import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HealthLog } from './health-log.entity';

/**
 * Keeps the database warm with one scheduled write per day.
 * `/health` itself stays as light as possible and does not touch memory
 * counters or the database.
 */
@Injectable()
export class HealthLogService {
  private readonly logger = new Logger(HealthLogService.name);

  constructor(
    @InjectRepository(HealthLog)
    private readonly repo: Repository<HealthLog>,
  ) {}

  /**
   * Runs every day at 00:00 GMT+3 (21:00 UTC) and writes one tiny heartbeat
   * row. This is only meant to wake the database, not count uptime pings.
   */
  @Cron('0 0 21 * * *', { name: 'database-daily-wake' })
  async wakeDatabase(): Promise<void> {
    const now = new Date();
    try {
      await this.repo.save({
        pingCount: 1,
        firstPingAt: now,
        lastPingAt: now,
      });
      this.logger.log(`Daily database wake heartbeat written at ${now.toISOString()}`);
    } catch (err) {
      this.logger.error(`Failed to write daily database wake heartbeat: ${(err as Error).message}`);
    }
  }

  /**
   * Returns the most recent `limit` flushed batches, newest first.
   */
  async getReport(limit = 30): Promise<HealthLog[]> {
    return this.repo
      .createQueryBuilder('h')
      .orderBy('h.id', 'DESC')
      .limit(limit)
      .getMany();
  }

  /**
   * Kept for the health report response shape. `/health` no longer tracks
   * pings, so there is never a pending in-memory batch.
   */
  getPending(): {
    pingCount: number;
    firstPingAt: Date | null;
    lastPingAt: Date | null;
  } {
    return {
      pingCount: 0,
      firstPingAt: null,
      lastPingAt: null,
    };
  }
}

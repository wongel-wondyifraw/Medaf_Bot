import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HealthLog } from './health-log.entity';

/**
 * Number of pings that constitutes one "report" (~24 hours at a 10-minute
 * external ping interval: 24 * 60 / 10 = 144).
 */
export const HEALTH_FLUSH_THRESHOLD = 144;

interface CounterSnapshot {
  pingCount: number;
  firstPingAt: Date;
  lastPingAt: Date;
}

@Injectable()
export class HealthLogService implements OnApplicationShutdown {
  private readonly logger = new Logger(HealthLogService.name);

  private pingCount = 0;
  private firstPingAt: Date | null = null;
  private lastPingAt: Date | null = null;

  constructor(
    @InjectRepository(HealthLog)
    private readonly repo: Repository<HealthLog>,
  ) {}

  /**
   * Increments the in-memory counter. When it reaches the flush threshold
   * (144 pings ≈ 24h), the batch is written to the database and the
   * counter resets.
   *
   * Node.js is single-threaded for JS execution, so the increment + threshold
   * check below cannot race with another invocation. The DB write is fired
   * asynchronously after the counter has already been reset.
   */
  recordPing(): void {
    const now = new Date();
    this.pingCount += 1;
    if (this.pingCount === 1) {
      this.firstPingAt = now;
    }
    this.lastPingAt = now;

    if (this.pingCount >= HEALTH_FLUSH_THRESHOLD) {
      const snapshot = this.snapshotAndReset();
      if (snapshot) {
        void this.flush(snapshot);
      }
    }
  }

  /**
   * Captures the current counter state and resets it atomically.
   * Returns null if there is nothing to flush.
   */
  private snapshotAndReset(): CounterSnapshot | null {
    if (this.pingCount === 0 || !this.firstPingAt || !this.lastPingAt) {
      return null;
    }
    const snapshot: CounterSnapshot = {
      pingCount: this.pingCount,
      firstPingAt: this.firstPingAt,
      lastPingAt: this.lastPingAt,
    };
    this.pingCount = 0;
    this.firstPingAt = null;
    this.lastPingAt = null;
    return snapshot;
  }

  private async flush(snapshot: CounterSnapshot): Promise<void> {
    try {
      await this.repo.save({
        pingCount: snapshot.pingCount,
        firstPingAt: snapshot.firstPingAt,
        lastPingAt: snapshot.lastPingAt,
      });
      this.logger.log(
        `Flushed health batch: ${snapshot.pingCount} pings ` +
          `(${snapshot.firstPingAt.toISOString()} → ${snapshot.lastPingAt.toISOString()})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to flush health batch (${snapshot.pingCount} pings lost): ${(err as Error).message}`,
      );
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
   * Returns the current in-memory counter state (not yet flushed).
   */
  getPending(): { pingCount: number; firstPingAt: Date | null; lastPingAt: Date | null } {
    return {
      pingCount: this.pingCount,
      firstPingAt: this.firstPingAt,
      lastPingAt: this.lastPingAt,
    };
  }

  /**
   * Flush any in-flight counter when the app is shutting down so partial
   * batches are not lost across deploys / restarts.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const snapshot = this.snapshotAndReset();
    if (!snapshot) return;
    this.logger.log(
      `Shutdown (${signal ?? 'unknown'}): flushing partial health batch of ${snapshot.pingCount} pings`,
    );
    await this.flush(snapshot);
  }
}

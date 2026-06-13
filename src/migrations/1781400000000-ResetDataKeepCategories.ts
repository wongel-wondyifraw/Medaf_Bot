import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wipes operational data for a fresh start while preserving category
 * definitions (shipping, commission, Dubai factors).
 *
 * Clears: orders, resellers, settings, admins, aed_observations, health_log.
 * Keeps: categories (+ TypeORM migrations history).
 */
export class ResetDataKeepCategories1781400000000 implements MigrationInterface {
  name = 'ResetDataKeepCategories1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      TRUNCATE TABLE
        "orders",
        "aed_observations",
        "health_log",
        "resellers",
        "settings",
        "admins"
      RESTART IDENTITY CASCADE
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible data wipe — no restore path.
  }
}

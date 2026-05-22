import { MigrationInterface, QueryRunner } from 'typeorm';

export class HealthLog1779400000000 implements MigrationInterface {
  name = 'HealthLog1779400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "health_log" (
        "id" BIGSERIAL NOT NULL,
        "ping_count" INTEGER NOT NULL,
        "first_ping_at" TIMESTAMPTZ NOT NULL,
        "last_ping_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_health_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_health_log_created_at"
      ON "health_log" ("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_health_log_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "health_log"`);
  }
}

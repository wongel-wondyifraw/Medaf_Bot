import { MigrationInterface, QueryRunner } from 'typeorm';

export class Admins1779200000000 implements MigrationInterface {
  name = 'Admins1779200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admins" (
        "id" SERIAL NOT NULL,
        "telegram_id" BIGINT NOT NULL,
        "telegram_username" TEXT,
        "added_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_notified_at" TIMESTAMPTZ,
        CONSTRAINT "PK_admins" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admins_telegram_id" UNIQUE ("telegram_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admins_telegram_id" ON "admins" ("telegram_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admins"`);
  }
}

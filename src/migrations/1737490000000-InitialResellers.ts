import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialResellers1737490000000 implements MigrationInterface {
  name = 'InitialResellers1737490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "resellers" (
        "id" SERIAL NOT NULL,
        "telegram_id" BIGINT NOT NULL,
        "telegram_username" TEXT,
        "full_name" TEXT,
        "phone_number" TEXT,
        "registered_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_resellers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resellers_telegram_id" UNIQUE ("telegram_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resellers_telegram_id" ON "resellers" ("telegram_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "resellers"`);
  }
}

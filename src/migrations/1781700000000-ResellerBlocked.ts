import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResellerBlocked1781700000000 implements MigrationInterface {
  name = 'ResellerBlocked1781700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resellers"
        ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "block_reason" TEXT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resellers_blocked_at"
        ON "resellers" ("blocked_at")
        WHERE "blocked_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_resellers_blocked_at"`);
    await queryRunner.query(`
      ALTER TABLE "resellers"
        DROP COLUMN IF EXISTS "block_reason",
        DROP COLUMN IF EXISTS "blocked_at"
    `);
  }
}

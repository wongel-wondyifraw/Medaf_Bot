import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderApprovalWorkflow1781200000000 implements MigrationInterface {
  name = 'OrderApprovalWorkflow1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "original_selling_etb" INTEGER,
        ADD COLUMN IF NOT EXISTS "down_payment_etb" INTEGER,
        ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
        ADD COLUMN IF NOT EXISTS "admin_approved_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "payment_confirmed_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "original_selling_etb",
        DROP COLUMN IF EXISTS "down_payment_etb",
        DROP COLUMN IF EXISTS "rejection_reason",
        DROP COLUMN IF EXISTS "admin_approved_at",
        DROP COLUMN IF EXISTS "payment_confirmed_at"
    `);
  }
}

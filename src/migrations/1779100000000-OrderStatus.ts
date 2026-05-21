import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderStatus1779100000000 implements MigrationInterface {
  name = 'OrderStatus1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_status" ON "orders" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_status"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "cancelled_at"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderDetails1779600000000 implements MigrationInterface {
  name = 'OrderDetails1779600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "product_url" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "size" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "color" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "unit_etb" INTEGER NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "unit_etb",
        DROP COLUMN IF EXISTS "quantity",
        DROP COLUMN IF EXISTS "color",
        DROP COLUMN IF EXISTS "size",
        DROP COLUMN IF EXISTS "product_url"
    `);
  }
}

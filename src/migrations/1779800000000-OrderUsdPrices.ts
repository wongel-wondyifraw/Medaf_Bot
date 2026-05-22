import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderUsdPrices1779800000000 implements MigrationInterface {
  name = 'OrderUsdPrices1779800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "scraped_unit_usd" NUMERIC(10, 2) NULL,
        ADD COLUMN IF NOT EXISTS "user_unit_usd" NUMERIC(10, 2) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "user_unit_usd",
        DROP COLUMN IF EXISTS "scraped_unit_usd"
    `);
  }
}

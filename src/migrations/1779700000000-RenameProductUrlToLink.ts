import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Safety migration: if a previous deploy of OrderDetails1779600000000 already
 * added a "product_url" column to the orders table, migrate its data into
 * "link" and drop the old column. On fresh databases this is a no-op.
 */
export class RenameProductUrlToLink1779700000000 implements MigrationInterface {
  name = 'RenameProductUrlToLink1779700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'product_url'
        ) THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'link'
          ) THEN
            EXECUTE 'ALTER TABLE "orders" RENAME COLUMN "product_url" TO "link"';
          ELSE
            EXECUTE 'UPDATE "orders" SET "link" = "product_url" WHERE "link" IS NULL AND "product_url" IS NOT NULL';
            EXECUTE 'ALTER TABLE "orders" DROP COLUMN "product_url"';
          END IF;
        END IF;
      END $$;
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op — we never want to recreate product_url.
  }
}

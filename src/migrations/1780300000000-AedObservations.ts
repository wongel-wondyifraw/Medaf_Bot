import { MigrationInterface, QueryRunner } from 'typeorm';

export class AedObservations1780300000000 implements MigrationInterface {
  name = 'AedObservations1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aed_observations" (
        "id" SERIAL PRIMARY KEY,
        "product_id" TEXT NOT NULL,
        "product_link" TEXT NOT NULL,
        "category_name" TEXT NOT NULL,
        "broad_group" TEXT NOT NULL,
        "eth_usd" NUMERIC(10, 2) NOT NULL,
        "aed_price" NUMERIC(10, 2) NOT NULL,
        "usd_to_aed_at_obs" NUMERIC(10, 4) NOT NULL,
        "dubai_usd_implied" NUMERIC(10, 2) NOT NULL,
        "factor_implied" NUMERIC(6, 4) NOT NULL,
        "observed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_aed_obs_product_id"
        ON "aed_observations" ("product_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_aed_obs_category_name"
        ON "aed_observations" ("category_name")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_aed_obs_broad_group"
        ON "aed_observations" ("broad_group")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "aed_observations"`);
  }
}

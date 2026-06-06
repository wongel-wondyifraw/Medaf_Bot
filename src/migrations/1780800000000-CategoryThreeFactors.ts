import { MigrationInterface, QueryRunner } from 'typeorm';
import { CATEGORY_THREE_FACTOR_SEED } from '../categories/category-three-factors';

export class CategoryThreeFactors1780800000000 implements MigrationInterface {
  name = 'CategoryThreeFactors1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "dubai_factor_low" NUMERIC(6, 4) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "dubai_factor_avg" NUMERIC(6, 4) NULL
    `);

    await queryRunner.query(`
      UPDATE "categories"
      SET "dubai_factor_low" = "dubai_factor"
      WHERE "dubai_factor_low" IS NULL AND "dubai_factor" IS NOT NULL
    `);

    for (const [name, factors] of Object.entries(CATEGORY_THREE_FACTOR_SEED)) {
      await queryRunner.query(
        `UPDATE "categories"
         SET "dubai_factor_low" = $1,
             "dubai_factor_avg" = $2,
             "dubai_factor_high" = $3,
             "dubai_factor" = $1
         WHERE "name" = $4`,
        [factors.low, factors.avg, factors.high, name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "dubai_factor_avg"
    `);
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "dubai_factor_low"
    `);
  }
}

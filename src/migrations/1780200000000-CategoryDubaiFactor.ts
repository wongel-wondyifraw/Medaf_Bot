import { MigrationInterface, QueryRunner } from 'typeorm';

const DEFAULT_BY_GROUP: Record<string, number> = {
  clothing: 0.76,
  shoes: 0.82,
  accessories: 0.85,
  beauty: 0.88,
  home: 0.9,
};

/** Category name -> broad group for seeding dubai_factor. */
const CATEGORY_GROUP: Record<string, keyof typeof DEFAULT_BY_GROUP> = {
  'Men shoes': 'shoes',
  'Girls closed Shoes': 'shoes',
  'Girls flat Shoes': 'shoes',
  'Girls Hill Shoes': 'shoes',
  Cosmetics: 'beauty',
  'Phone Cover': 'accessories',
  'Bag(big)': 'accessories',
  'Bag(small)': 'accessories',
  watch: 'accessories',
  'Eye glass': 'accessories',
  Jewelery: 'accessories',
};

export class CategoryDubaiFactor1780200000000 implements MigrationInterface {
  name = 'CategoryDubaiFactor1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "dubai_factor" NUMERIC(6, 4) NULL
    `);

    for (const [name, group] of Object.entries(CATEGORY_GROUP)) {
      const factor = DEFAULT_BY_GROUP[group];
      await queryRunner.query(
        `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" = $2`,
        [factor, name],
      );
    }

    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor" = $1 WHERE "dubai_factor" IS NULL`,
      [DEFAULT_BY_GROUP.clothing],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "dubai_factor"
    `);
  }
}

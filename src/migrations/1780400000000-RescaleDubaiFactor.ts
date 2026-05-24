import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rescale every category's dubai_factor by 165/200 = 0.825.
 *
 * Context: USD->ETB is now displayed as 200 in admin settings, but the
 * intended Dubai-cost math should still produce the same totals as when the
 * rate was 165. Applying the compensation factor to dubai_factor here keeps
 * the live rate as-is while shifting the calculator output back to the old
 * baseline.
 *
 * The new factor table (clothing 0.627, shoes 0.6765, etc.) matches
 * DEFAULT_DUBAI_FACTOR_BY_GROUP in src/calculator/broad-group.ts so fresh
 * deploys and migrated deploys converge.
 */
const RESCALED_BY_GROUP: Record<string, number> = {
  clothing: 0.627,
  shoes: 0.6765,
  accessories: 0.70125,
  beauty: 0.726,
  home: 0.7425,
};

const CATEGORY_GROUP: Record<string, keyof typeof RESCALED_BY_GROUP> = {
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

const ORIGINAL_BY_GROUP: Record<string, number> = {
  clothing: 0.76,
  shoes: 0.82,
  accessories: 0.85,
  beauty: 0.88,
  home: 0.9,
};

export class RescaleDubaiFactor1780400000000 implements MigrationInterface {
  name = 'RescaleDubaiFactor1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, group] of Object.entries(CATEGORY_GROUP)) {
      await queryRunner.query(
        `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" = $2`,
        [RESCALED_BY_GROUP[group], name],
      );
    }

    // Anything else (clothing default or unknown) drops to clothing scale.
    const known = Object.keys(CATEGORY_GROUP);
    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" NOT IN (${known
        .map((_, i) => `$${i + 2}`)
        .join(', ')})`,
      [RESCALED_BY_GROUP.clothing, ...known],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name, group] of Object.entries(CATEGORY_GROUP)) {
      await queryRunner.query(
        `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" = $2`,
        [ORIGINAL_BY_GROUP[group], name],
      );
    }
    const known = Object.keys(CATEGORY_GROUP);
    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" NOT IN (${known
        .map((_, i) => `$${i + 2}`)
        .join(', ')})`,
      [ORIGINAL_BY_GROUP.clothing, ...known],
    );
  }
}

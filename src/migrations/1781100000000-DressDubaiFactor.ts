import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calibrate Dress Dubai factors for mid-price items (skirts, dresses).
 *
 * At USD→ETB 200, delivery 800 (600+200), 30% margin, ×1.1 final:
 *   $12 USD × avg factor 0.82 → ~3,695 ETB (target ~3,700).
 *
 * Previous avg 0.72 produced ~3,352 ETB for the same inputs when skirts
 * were misclassified as N/A (default delivery 500 → ~3,022 ETB).
 */
const DRESS_LOW = 0.4;
const DRESS_AVG = 0.82;
const DRESS_HIGH = 1.15;

const PREVIOUS_LOW = 0.4;
const PREVIOUS_AVG = 0.72;
const PREVIOUS_HIGH = 1.15;

export class DressDubaiFactor1781100000000 implements MigrationInterface {
  name = 'DressDubaiFactor1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories"
       SET "dubai_factor_low" = $1,
           "dubai_factor_avg" = $2,
           "dubai_factor_high" = $3,
           "dubai_factor" = $1
       WHERE "name" = 'Dress'`,
      [DRESS_LOW, DRESS_AVG, DRESS_HIGH],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories"
       SET "dubai_factor_low" = $1,
           "dubai_factor_avg" = $2,
           "dubai_factor_high" = $3,
           "dubai_factor" = $1
       WHERE "name" = 'Dress'`,
      [PREVIOUS_LOW, PREVIOUS_AVG, PREVIOUS_HIGH],
    );
  }
}

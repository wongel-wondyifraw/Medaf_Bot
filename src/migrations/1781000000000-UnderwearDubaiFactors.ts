import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calibrate Underwear Dubai factors for frequently ordered small items
 * (nipple covers, bra accessories, lingerie).
 *
 * At USD→ETB 200, delivery 250 (150+100), 30% margin, ×1.1 final multiplier:
 *   $6 USD × avg factor 0.90 → ~1,821 ETB (target ~1,830).
 *
 * Previous avg 0.62 produced ~1,340 ETB for the same inputs — too low once
 * products were correctly classified as Underwear instead of Wedding Dress.
 */
const UNDERWEAR_LOW = 0.45;
const UNDERWEAR_AVG = 0.9;
const UNDERWEAR_HIGH = 1.15;

const PREVIOUS_LOW = 0.3;
const PREVIOUS_AVG = 0.62;
const PREVIOUS_HIGH = 1.05;

export class UnderwearDubaiFactors1781000000000 implements MigrationInterface {
  name = 'UnderwearDubaiFactors1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories"
       SET "dubai_factor_low" = $1,
           "dubai_factor_avg" = $2,
           "dubai_factor_high" = $3,
           "dubai_factor" = $1
       WHERE "name" = 'Underwear'`,
      [UNDERWEAR_LOW, UNDERWEAR_AVG, UNDERWEAR_HIGH],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories"
       SET "dubai_factor_low" = $1,
           "dubai_factor_avg" = $2,
           "dubai_factor_high" = $3,
           "dubai_factor" = $1
       WHERE "name" = 'Underwear'`,
      [PREVIOUS_LOW, PREVIOUS_AVG, PREVIOUS_HIGH],
    );
  }
}

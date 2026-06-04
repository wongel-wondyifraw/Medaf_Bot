import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calibrate the T-shirt category Dubai factor.
 *
 * Context: the generic clothing factor (0.627) under-priced cheap tees. At the
 * live USD->ETB rate of 200 and 30% margin, a $5.03 tee produced ~1,300 ETB,
 * but the verified target is ~1,800 ETB. Solving for the factor:
 *
 *   factor = (target - delivery) / (ethUsd * rate * (1 + margin))
 *          = (1800 - 400) / (5.03 * 200 * 1.30)
 *          ≈ 1.07
 *
 * where T-shirt delivery = 300 fee + 100 commission = 400 ETB.
 */
const TSHIRT_DUBAI_FACTOR = 1.07;
const PREVIOUS_CLOTHING_FACTOR = 0.627;

export class TshirtDubaiFactor1780600000000 implements MigrationInterface {
  name = 'TshirtDubaiFactor1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" = 'T-shirt'`,
      [TSHIRT_DUBAI_FACTOR],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor" = $1 WHERE "name" = 'T-shirt'`,
      [PREVIOUS_CLOTHING_FACTOR],
    );
  }
}

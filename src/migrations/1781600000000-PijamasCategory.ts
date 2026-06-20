import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lightweight sleepwear — Dubai factors aligned with Body top. */
const PIJAMAS_LOW = 0.35;
const PIJAMAS_AVG = 0.68;
const PIJAMAS_HIGH = 1.1;

export class PijamasCategory1781600000000 implements MigrationInterface {
  name = 'PijamasCategory1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "categories" (
        "name",
        "shipping_cost",
        "commission_etb",
        "dubai_factor",
        "dubai_factor_low",
        "dubai_factor_avg",
        "dubai_factor_high"
      ) VALUES
        ('Pijamas', 500, 200, $1, $1, $2, $3)
      ON CONFLICT ("name") DO UPDATE SET
        "shipping_cost" = EXCLUDED."shipping_cost",
        "commission_etb" = EXCLUDED."commission_etb",
        "dubai_factor" = EXCLUDED."dubai_factor",
        "dubai_factor_low" = EXCLUDED."dubai_factor_low",
        "dubai_factor_avg" = EXCLUDED."dubai_factor_avg",
        "dubai_factor_high" = EXCLUDED."dubai_factor_high"
    `,
      [PIJAMAS_LOW, PIJAMAS_AVG, PIJAMAS_HIGH],
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op on revert so admins do not lose the row if they have customised it.
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryDubaiFactorHigh1780700000000 implements MigrationInterface {
  name = 'CategoryDubaiFactorHigh1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "dubai_factor_high" NUMERIC(6, 4) NULL
    `);

    await queryRunner.query(
      `UPDATE "categories" SET "dubai_factor_high" = $1 WHERE "dubai_factor_high" IS NULL`,
      [1.1],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "dubai_factor_high"
    `);
  }
}

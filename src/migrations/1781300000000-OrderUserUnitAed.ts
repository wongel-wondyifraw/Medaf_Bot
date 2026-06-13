import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderUserUnitAed1781300000000 implements MigrationInterface {
  name = 'OrderUserUnitAed1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "user_unit_aed" NUMERIC(10, 2) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "user_unit_aed"
    `);
  }
}

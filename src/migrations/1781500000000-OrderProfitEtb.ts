import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderProfitEtb1781500000000 implements MigrationInterface {
  name = 'OrderProfitEtb1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "profit_etb" INTEGER NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "profit_etb"
    `);
  }
}

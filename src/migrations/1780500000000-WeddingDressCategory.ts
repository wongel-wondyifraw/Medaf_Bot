import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeddingDressCategory1780500000000 implements MigrationInterface {
  name = 'WeddingDressCategory1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "categories" ("name", "shipping_cost", "commission_etb", "dubai_factor") VALUES
        ('Wedding Dress', 2000, 2000, 0.627)
      ON CONFLICT ("name") DO UPDATE SET
        "shipping_cost" = EXCLUDED."shipping_cost",
        "commission_etb" = EXCLUDED."commission_etb"
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op on revert so admins do not lose the row if they have customised it.
  }
}

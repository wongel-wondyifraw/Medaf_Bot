import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryCommission1780000000000 implements MigrationInterface {
  name = 'CategoryCommission1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "commission_etb" NUMERIC(10, 2) NULL
    `);

    await queryRunner.query(`
      INSERT INTO "categories" ("name", "shipping_cost", "commission_etb") VALUES
        ('Men shoes', 1200, 200),
        ('Girls closed Shoes', 1000, 100),
        ('Girls flat Shoes', 500, 200),
        ('Girls Hill Shoes', 600, 200),
        ('Jeans', 500, 150),
        ('Trousers', 500, 150),
        ('Dress', 600, 200),
        ('Short Dress', 400, 100),
        ('Body top', 250, 100),
        ('Jacket big', 700, 200),
        ('Jacket small', 500, 150),
        ('Phone Cover', 150, 50),
        ('Shirt', 400, 100),
        ('T-shirt', 300, 100),
        ('Bag(big)', 600, 200),
        ('Bag(small)', 400, 200),
        ('watch', 400, 200),
        ('2pc Cloth', 600, 200),
        ('Eye glass', 200, 100),
        ('Jewelery', 150, 50),
        ('Underwear', 150, 100)
      ON CONFLICT ("name") DO UPDATE SET
        "shipping_cost" = EXCLUDED."shipping_cost",
        "commission_etb" = EXCLUDED."commission_etb"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "commission_etb"
    `);
  }
}

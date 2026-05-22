import { MigrationInterface, QueryRunner } from 'typeorm';

export class Categories1779500000000 implements MigrationInterface {
  name = 'Categories1779500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "categories" (
        "id" SERIAL NOT NULL,
        "name" TEXT NOT NULL,
        "shippingcost" NUMERIC(10, 2) NULL,
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_categories_name" UNIQUE ("name")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_categories_name" ON "categories" ("name")
    `);
    await queryRunner.query(`
      INSERT INTO "categories" ("name") VALUES
        ('New In'), ('Sale'), ('Women Clothing'), ('Beachwear'),
        ('Kids'), ('Curve'), ('Men Clothing'), ('Shoes'),
        ('Underwear & Sleepwear'), ('Home & Living'),
        ('Jewelry & Accessories'), ('Beauty & Health'),
        ('Baby & Maternity'), ('Bags & Luggage'),
        ('Sports & Outdoors'), ('Home Textiles'),
        ('Cell Phones & Accessories'), ('Electronics'),
        ('Toys & Games'), ('Tools & Home Improvement'),
        ('Office & School Supplies'), ('Pet Supplies'),
        ('Appliances'), ('Automotive'),
        ('Books & Magazine'), ('Food & Beverages')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_categories_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "categories"`);
  }
}

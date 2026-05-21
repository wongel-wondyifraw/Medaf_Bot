import { MigrationInterface, QueryRunner } from 'typeorm';

export class Orders1779000000000 implements MigrationInterface {
  name = 'Orders1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" SERIAL NOT NULL,
        "reseller_id" INTEGER NOT NULL,
        "product_id" TEXT,
        "product_title" TEXT NOT NULL,
        "selling_etb" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_reseller" FOREIGN KEY ("reseller_id")
          REFERENCES "resellers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_reseller_id" ON "orders" ("reseller_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_created_at" ON "orders" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryAiCreated1780900000000 implements MigrationInterface {
  name = 'CategoryAiCreated1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "ai_created" BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN IF NOT EXISTS "source_title" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "source_title"
    `);
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP COLUMN IF EXISTS "ai_created"
    `);
  }
}

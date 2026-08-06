import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_navigations_placement" AS ENUM('primary', 'footer', 'utility', 'mobile', 'legal');
  CREATE TABLE "sections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"key" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"blocks" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "navigations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"placement" "enum_navigations_placement" NOT NULL,
  	"owner_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"items" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "navigations_id" integer;
  ALTER TABLE "sections" ADD CONSTRAINT "sections_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "navigations" ADD CONSTRAINT "navigations_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "sections_key_idx" ON "sections" USING btree ("key");
  CREATE INDEX "sections_owner_idx" ON "sections" USING btree ("owner_id");
  CREATE INDEX "sections_locale_idx" ON "sections" USING btree ("locale");
  CREATE INDEX "sections_updated_at_idx" ON "sections" USING btree ("updated_at");
  CREATE INDEX "sections_created_at_idx" ON "sections" USING btree ("created_at");
  CREATE INDEX "navigations_placement_idx" ON "navigations" USING btree ("placement");
  CREATE INDEX "navigations_owner_idx" ON "navigations" USING btree ("owner_id");
  CREATE INDEX "navigations_locale_idx" ON "navigations" USING btree ("locale");
  CREATE INDEX "navigations_updated_at_idx" ON "navigations" USING btree ("updated_at");
  CREATE INDEX "navigations_created_at_idx" ON "navigations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sections_fk" FOREIGN KEY ("sections_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_navigations_fk" FOREIGN KEY ("navigations_id") REFERENCES "public"."navigations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_sections_id_idx" ON "payload_locked_documents_rels" USING btree ("sections_id");
  CREATE INDEX "payload_locked_documents_rels_navigations_id_idx" ON "payload_locked_documents_rels" USING btree ("navigations_id");`)

  /**
   * Уникальность пары «владелец + ключ + язык» — на уровне БД, а не хука.
   *
   * Две секции с одним ключом у одного владельца сделали бы выбор при
   * наследовании зависящим от порядка чтения: страница получала бы то одну,
   * то другую. Проверка в приложении такого не ловит — между чтением и
   * записью помещается вторая вкладка редактора.
   */
  await db.execute(sql`
    CREATE UNIQUE INDEX "sections_owner_key_locale_uniq"
      ON "sections" USING btree ("owner_id", "key", "locale");
    CREATE UNIQUE INDEX "navigations_owner_placement_locale_uniq"
      ON "navigations" USING btree ("owner_id", "placement", "locale");
  `)
}

/**
 * Порядок обратный порядку создания: сначала внешние ключи и индексы, затем
 * колонки, и только потом таблицы (BUG-003). `IF EXISTS` — чтобы откат
 * частично применённой миграции не спотыкался о недостающий объект.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "sections_owner_key_locale_uniq";
  DROP INDEX IF EXISTS "navigations_owner_placement_locale_uniq";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_sections_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_navigations_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_sections_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_navigations_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "sections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "navigations_id";
  ALTER TABLE "sections" DROP CONSTRAINT IF EXISTS "sections_owner_id_tenants_id_fk";
  ALTER TABLE "navigations" DROP CONSTRAINT IF EXISTS "navigations_owner_id_tenants_id_fk";
  DROP TABLE IF EXISTS "sections" CASCADE;
  DROP TABLE IF EXISTS "navigations" CASCADE;
  DROP TYPE IF EXISTS "public"."enum_navigations_placement";`)
}

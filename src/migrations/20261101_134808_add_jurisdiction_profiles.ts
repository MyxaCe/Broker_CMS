import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_jurisdiction_profiles_client_categories" AS ENUM('retail', 'professional');
  CREATE TABLE "jurisdiction_profiles_client_categories" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_jurisdiction_profiles_client_categories",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "jurisdiction_profiles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"is_default" boolean DEFAULT false,
  	"negative_balance_protection" boolean DEFAULT true NOT NULL,
  	"margin_call_percent" numeric DEFAULT 100,
  	"margin_close_out_percent" numeric DEFAULT 50,
  	"max_leverage" numeric DEFAULT 100,
  	"data_residency" varchar,
  	"regulator" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "jurisdiction_profiles_id" integer;
  ALTER TABLE "jurisdiction_profiles_client_categories" ADD CONSTRAINT "jurisdiction_profiles_client_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."jurisdiction_profiles"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "jurisdiction_profiles_client_categories_order_idx" ON "jurisdiction_profiles_client_categories" USING btree ("order");
  CREATE INDEX "jurisdiction_profiles_client_categories_parent_idx" ON "jurisdiction_profiles_client_categories" USING btree ("parent_id");
  CREATE UNIQUE INDEX "jurisdiction_profiles_code_idx" ON "jurisdiction_profiles" USING btree ("code");
  CREATE INDEX "jurisdiction_profiles_is_default_idx" ON "jurisdiction_profiles" USING btree ("is_default");
  CREATE INDEX "jurisdiction_profiles_updated_at_idx" ON "jurisdiction_profiles" USING btree ("updated_at");
  CREATE INDEX "jurisdiction_profiles_created_at_idx" ON "jurisdiction_profiles" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_jurisdiction_profiles_fk" FOREIGN KEY ("jurisdiction_profiles_id") REFERENCES "public"."jurisdiction_profiles"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_jurisdiction_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("jurisdiction_profiles_id");`)

  /**
   * Профиль по умолчанию — Сейшелы с РАБОЧИМИ значениями (CMS-24, Р-236, Р-237,
   * Р-456 D).
   *
   * Сид в миграции, а не в коде приложения: «по умолчанию — Сейшелы» обязано
   * стать правдой на накате. Идемпотентно (`ON CONFLICT`/`NOT EXISTS`). Значения
   * рабочие, а не нули: защита от отрицательного баланса (политика брокера,
   * Р-281), маржин-колл 100 %, стоп-аут 50 %, потолок плеча 1:100 (Р-226, Р-237).
   * `data_residency` остаётся пустым намеренно — это вопрос к юристу, а не
   * обоснуемый дефолт. Реальные числа уточняются БЕЗ релиза (конфиг, не код).
   */
  await db.execute(sql`
   INSERT INTO "jurisdiction_profiles"
  	("code", "name", "is_default", "negative_balance_protection", "margin_call_percent", "margin_close_out_percent", "max_leverage")
  VALUES ('SC', 'Сейшелы', true, true, 100, 50, 100)
  ON CONFLICT ("code") DO NOTHING;
  INSERT INTO "jurisdiction_profiles_client_categories" ("order", "parent_id", "value")
  SELECT 1, p.id, 'retail' FROM "jurisdiction_profiles" p
  WHERE p.code = 'SC' AND NOT EXISTS (
  	SELECT 1 FROM "jurisdiction_profiles_client_categories" c
  	WHERE c.parent_id = p.id AND c.value = 'retail'
  );
  INSERT INTO "jurisdiction_profiles_client_categories" ("order", "parent_id", "value")
  SELECT 2, p.id, 'professional' FROM "jurisdiction_profiles" p
  WHERE p.code = 'SC' AND NOT EXISTS (
  	SELECT 1 FROM "jurisdiction_profiles_client_categories" c
  	WHERE c.parent_id = p.id AND c.value = 'professional'
  );`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  /**
   * Порядок переписан вручную — BUG-003.
   *
   * Генератор ставит `DROP TABLE ... CASCADE` перед снятием внешнего ключа на
   * `payload_locked_documents_rels`, который этот же `CASCADE` уже удалил, и
   * откат падает на несуществующем ограничении. Связь снимается до таблицы;
   * `IF EXISTS` оставлен, чтобы откат был выполним и после частичного
   * применения.
   */
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_jurisdiction_profiles_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_jurisdiction_profiles_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "jurisdiction_profiles_id";
  ALTER TABLE "jurisdiction_profiles_client_categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "jurisdiction_profiles" DISABLE ROW LEVEL SECURITY;
  DROP TABLE IF EXISTS "jurisdiction_profiles_client_categories" CASCADE;
  DROP TABLE IF EXISTS "jurisdiction_profiles" CASCADE;
  DROP TYPE IF EXISTS "public"."enum_jurisdiction_profiles_client_categories";`)
}

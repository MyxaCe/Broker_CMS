import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_disclaimers_key" AS ENUM('disclaimer.calculator', 'disclaimer.market-data', 'disclaimer.trading-conditions');
  CREATE TABLE "disclaimers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" "enum_disclaimers_key" NOT NULL,
  	"locale" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"jurisdiction" varchar,
  	"text" varchar NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "disclaimers_id" integer;
  ALTER TABLE "disclaimers" ADD CONSTRAINT "disclaimers_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "disclaimers_key_idx" ON "disclaimers" USING btree ("key");
  CREATE INDEX "disclaimers_locale_idx" ON "disclaimers" USING btree ("locale");
  CREATE INDEX "disclaimers_owner_idx" ON "disclaimers" USING btree ("owner_id");
  CREATE INDEX "disclaimers_is_active_idx" ON "disclaimers" USING btree ("is_active");
  CREATE INDEX "disclaimers_updated_at_idx" ON "disclaimers" USING btree ("updated_at");
  CREATE INDEX "disclaimers_created_at_idx" ON "disclaimers" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_disclaimers_fk" FOREIGN KEY ("disclaimers_id") REFERENCES "public"."disclaimers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_disclaimers_id_idx" ON "payload_locked_documents_rels" USING btree ("disclaimers_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  /**
   * Порядок переписан вручную — BUG-003.
   *
   * Генератор ставит `DROP TABLE ... CASCADE` перед снятием внешнего ключа,
   * который этот же `CASCADE` уже удалил, и откат падает на несуществующем
   * ограничении. Связи снимаются до таблицы, а не после; `IF EXISTS`
   * оставлен, чтобы откат был выполним и после частичного применения.
   */
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_disclaimers_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_disclaimers_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "disclaimers_id";
  ALTER TABLE "disclaimers" DISABLE ROW LEVEL SECURITY;
  DROP TABLE IF EXISTS "disclaimers" CASCADE;
  DROP TYPE IF EXISTS "public"."enum_disclaimers_key";`)
}

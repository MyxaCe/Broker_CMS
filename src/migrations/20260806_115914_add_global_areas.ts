import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_global_areas_kind" AS ENUM('header', 'footer', 'announcement', 'cookie-banner', 'risk-warning', 'popup');
  CREATE TABLE "global_areas_jurisdictions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL
  );
  
  CREATE TABLE "global_areas" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"kind" "enum_global_areas_kind" NOT NULL,
  	"owner_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"blocks" jsonb,
  	"risk_warning_text" varchar,
  	"risk_warning_loss_percentage" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "global_areas_id" integer;
  ALTER TABLE "global_areas_jurisdictions" ADD CONSTRAINT "global_areas_jurisdictions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."global_areas"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "global_areas" ADD CONSTRAINT "global_areas_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "global_areas_jurisdictions_order_idx" ON "global_areas_jurisdictions" USING btree ("_order");
  CREATE INDEX "global_areas_jurisdictions_parent_id_idx" ON "global_areas_jurisdictions" USING btree ("_parent_id");
  CREATE INDEX "global_areas_kind_idx" ON "global_areas" USING btree ("kind");
  CREATE INDEX "global_areas_owner_idx" ON "global_areas" USING btree ("owner_id");
  CREATE INDEX "global_areas_locale_idx" ON "global_areas" USING btree ("locale");
  CREATE INDEX "global_areas_updated_at_idx" ON "global_areas" USING btree ("updated_at");
  CREATE INDEX "global_areas_created_at_idx" ON "global_areas" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_global_areas_fk" FOREIGN KEY ("global_areas_id") REFERENCES "public"."global_areas"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_global_areas_id_idx" ON "payload_locked_documents_rels" USING btree ("global_areas_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "global_areas_jurisdictions" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "global_areas" DISABLE ROW LEVEL SECURITY;
  `)

  /** Связи снимаются до таблиц — причина в [[BUG-003]]. */
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_global_areas_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_global_areas_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "global_areas_id";
    DROP TABLE IF EXISTS "global_areas_jurisdictions" CASCADE;
    DROP TABLE IF EXISTS "global_areas" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_global_areas_kind";
  `)
}

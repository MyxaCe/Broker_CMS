import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_instrument_access_instruments_standing_at_save" AS ENUM('quoted', 'listed-unquoted', 'absent', 'unknown');
  CREATE TYPE "public"."enum_mds_universe_syncs_outcome" AS ENUM('fetched', 'unreachable', 'malformed');
  CREATE TABLE "instrument_access_instruments" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"symbol" varchar NOT NULL,
  	"confirmed_unquoted" boolean DEFAULT false,
  	"confirmed_reason" varchar,
  	"standing_at_save" "enum_instrument_access_instruments_standing_at_save",
  	"checked_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "instrument_access" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer NOT NULL,
  	"site_slug" varchar,
  	"instrument_count" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "mds_instruments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"symbol" varchar NOT NULL,
  	"name" varchar,
  	"group" varchar,
  	"category" varchar,
  	"provider" varchar,
  	"quoted" boolean DEFAULT false NOT NULL,
  	"synced_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "mds_universe_syncs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"finished_at" timestamp(3) with time zone NOT NULL,
  	"outcome" "enum_mds_universe_syncs_outcome" NOT NULL,
  	"instruments" numeric,
  	"quoted" numeric,
  	"reason" varchar,
  	"source" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "instrument_access_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mds_instruments_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mds_universe_syncs_id" integer;
  ALTER TABLE "instrument_access_instruments" ADD CONSTRAINT "instrument_access_instruments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."instrument_access"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "instrument_access" ADD CONSTRAINT "instrument_access_site_id_tenants_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "instrument_access_instruments_order_idx" ON "instrument_access_instruments" USING btree ("_order");
  CREATE INDEX "instrument_access_instruments_parent_id_idx" ON "instrument_access_instruments" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "instrument_access_site_idx" ON "instrument_access" USING btree ("site_id");
  CREATE INDEX "instrument_access_site_slug_idx" ON "instrument_access" USING btree ("site_slug");
  CREATE INDEX "instrument_access_updated_at_idx" ON "instrument_access" USING btree ("updated_at");
  CREATE INDEX "instrument_access_created_at_idx" ON "instrument_access" USING btree ("created_at");
  CREATE UNIQUE INDEX "mds_instruments_symbol_idx" ON "mds_instruments" USING btree ("symbol");
  CREATE INDEX "mds_instruments_group_idx" ON "mds_instruments" USING btree ("group");
  CREATE INDEX "mds_instruments_category_idx" ON "mds_instruments" USING btree ("category");
  CREATE INDEX "mds_instruments_provider_idx" ON "mds_instruments" USING btree ("provider");
  CREATE INDEX "mds_instruments_quoted_idx" ON "mds_instruments" USING btree ("quoted");
  CREATE INDEX "mds_instruments_synced_at_idx" ON "mds_instruments" USING btree ("synced_at");
  CREATE INDEX "mds_instruments_updated_at_idx" ON "mds_instruments" USING btree ("updated_at");
  CREATE INDEX "mds_instruments_created_at_idx" ON "mds_instruments" USING btree ("created_at");
  CREATE INDEX "mds_universe_syncs_started_at_idx" ON "mds_universe_syncs" USING btree ("started_at");
  CREATE INDEX "mds_universe_syncs_outcome_idx" ON "mds_universe_syncs" USING btree ("outcome");
  CREATE INDEX "mds_universe_syncs_updated_at_idx" ON "mds_universe_syncs" USING btree ("updated_at");
  CREATE INDEX "mds_universe_syncs_created_at_idx" ON "mds_universe_syncs" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_instrument_access_fk" FOREIGN KEY ("instrument_access_id") REFERENCES "public"."instrument_access"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mds_instruments_fk" FOREIGN KEY ("mds_instruments_id") REFERENCES "public"."mds_instruments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mds_universe_syncs_fk" FOREIGN KEY ("mds_universe_syncs_id") REFERENCES "public"."mds_universe_syncs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_instrument_access_id_idx" ON "payload_locked_documents_rels" USING btree ("instrument_access_id");
  CREATE INDEX "payload_locked_documents_rels_mds_instruments_id_idx" ON "payload_locked_documents_rels" USING btree ("mds_instruments_id");
  CREATE INDEX "payload_locked_documents_rels_mds_universe_syncs_id_idx" ON "payload_locked_documents_rels" USING btree ("mds_universe_syncs_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "instrument_access_instruments" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "instrument_access" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "mds_instruments" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "mds_universe_syncs" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "instrument_access_instruments" CASCADE;
  DROP TABLE "instrument_access" CASCADE;
  DROP TABLE "mds_instruments" CASCADE;
  DROP TABLE "mds_universe_syncs" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_instrument_access_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_mds_instruments_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_mds_universe_syncs_fk";
  
  DROP INDEX "payload_locked_documents_rels_instrument_access_id_idx";
  DROP INDEX "payload_locked_documents_rels_mds_instruments_id_idx";
  DROP INDEX "payload_locked_documents_rels_mds_universe_syncs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "instrument_access_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "mds_instruments_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "mds_universe_syncs_id";
  DROP TYPE "public"."enum_instrument_access_instruments_standing_at_save";
  DROP TYPE "public"."enum_mds_universe_syncs_outcome";`)
}

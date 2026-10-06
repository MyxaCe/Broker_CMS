import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tenants_demo_start_balance_cents_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_logo_light_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_logo_dark_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_logo_mono_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_logo_mark_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_favicon_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_email_logo_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_primary_color_mode" AS ENUM('inherit', 'override', 'fork');
  CREATE TYPE "public"."enum_tenants_socials_mode" AS ENUM('inherit', 'extend', 'fork');
  CREATE TABLE "tenants_socials_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"url" varchar NOT NULL
  );
  
  ALTER TABLE "tenants" ADD COLUMN "demo_start_balance_cents_mode" "enum_tenants_demo_start_balance_cents_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "demo_start_balance_cents_value" numeric;
  ALTER TABLE "tenants" ADD COLUMN "logo_light_mode" "enum_tenants_logo_light_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "logo_light_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "logo_dark_mode" "enum_tenants_logo_dark_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "logo_dark_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "logo_mono_mode" "enum_tenants_logo_mono_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "logo_mono_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "logo_mark_mode" "enum_tenants_logo_mark_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "logo_mark_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "favicon_mode" "enum_tenants_favicon_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "favicon_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "email_logo_mode" "enum_tenants_email_logo_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "email_logo_value_id" integer;
  ALTER TABLE "tenants" ADD COLUMN "primary_color_mode" "enum_tenants_primary_color_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "primary_color_value" varchar;
  ALTER TABLE "tenants" ADD COLUMN "socials_mode" "enum_tenants_socials_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants_socials_items" ADD CONSTRAINT "tenants_socials_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "tenants_socials_items_order_idx" ON "tenants_socials_items" USING btree ("_order");
  CREATE INDEX "tenants_socials_items_parent_id_idx" ON "tenants_socials_items" USING btree ("_parent_id");
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_light_value_id_media_id_fk" FOREIGN KEY ("logo_light_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_dark_value_id_media_id_fk" FOREIGN KEY ("logo_dark_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_mono_value_id_media_id_fk" FOREIGN KEY ("logo_mono_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_mark_value_id_media_id_fk" FOREIGN KEY ("logo_mark_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_favicon_value_id_media_id_fk" FOREIGN KEY ("favicon_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_email_logo_value_id_media_id_fk" FOREIGN KEY ("email_logo_value_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "tenants_logo_light_logo_light_value_idx" ON "tenants" USING btree ("logo_light_value_id");
  CREATE INDEX "tenants_logo_dark_logo_dark_value_idx" ON "tenants" USING btree ("logo_dark_value_id");
  CREATE INDEX "tenants_logo_mono_logo_mono_value_idx" ON "tenants" USING btree ("logo_mono_value_id");
  CREATE INDEX "tenants_logo_mark_logo_mark_value_idx" ON "tenants" USING btree ("logo_mark_value_id");
  CREATE INDEX "tenants_favicon_favicon_value_idx" ON "tenants" USING btree ("favicon_value_id");
  CREATE INDEX "tenants_email_logo_email_logo_value_idx" ON "tenants" USING btree ("email_logo_value_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tenants_socials_items" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "tenants_socials_items" CASCADE;
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_logo_light_value_id_media_id_fk";
  
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_logo_dark_value_id_media_id_fk";
  
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_logo_mono_value_id_media_id_fk";
  
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_logo_mark_value_id_media_id_fk";
  
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_favicon_value_id_media_id_fk";
  
  ALTER TABLE "tenants" DROP CONSTRAINT "tenants_email_logo_value_id_media_id_fk";
  
  DROP INDEX "tenants_logo_light_logo_light_value_idx";
  DROP INDEX "tenants_logo_dark_logo_dark_value_idx";
  DROP INDEX "tenants_logo_mono_logo_mono_value_idx";
  DROP INDEX "tenants_logo_mark_logo_mark_value_idx";
  DROP INDEX "tenants_favicon_favicon_value_idx";
  DROP INDEX "tenants_email_logo_email_logo_value_idx";
  ALTER TABLE "tenants" DROP COLUMN "demo_start_balance_cents_mode";
  ALTER TABLE "tenants" DROP COLUMN "demo_start_balance_cents_value";
  ALTER TABLE "tenants" DROP COLUMN "logo_light_mode";
  ALTER TABLE "tenants" DROP COLUMN "logo_light_value_id";
  ALTER TABLE "tenants" DROP COLUMN "logo_dark_mode";
  ALTER TABLE "tenants" DROP COLUMN "logo_dark_value_id";
  ALTER TABLE "tenants" DROP COLUMN "logo_mono_mode";
  ALTER TABLE "tenants" DROP COLUMN "logo_mono_value_id";
  ALTER TABLE "tenants" DROP COLUMN "logo_mark_mode";
  ALTER TABLE "tenants" DROP COLUMN "logo_mark_value_id";
  ALTER TABLE "tenants" DROP COLUMN "favicon_mode";
  ALTER TABLE "tenants" DROP COLUMN "favicon_value_id";
  ALTER TABLE "tenants" DROP COLUMN "email_logo_mode";
  ALTER TABLE "tenants" DROP COLUMN "email_logo_value_id";
  ALTER TABLE "tenants" DROP COLUMN "primary_color_mode";
  ALTER TABLE "tenants" DROP COLUMN "primary_color_value";
  ALTER TABLE "tenants" DROP COLUMN "socials_mode";
  DROP TYPE "public"."enum_tenants_demo_start_balance_cents_mode";
  DROP TYPE "public"."enum_tenants_logo_light_mode";
  DROP TYPE "public"."enum_tenants_logo_dark_mode";
  DROP TYPE "public"."enum_tenants_logo_mono_mode";
  DROP TYPE "public"."enum_tenants_logo_mark_mode";
  DROP TYPE "public"."enum_tenants_favicon_mode";
  DROP TYPE "public"."enum_tenants_email_logo_mode";
  DROP TYPE "public"."enum_tenants_primary_color_mode";
  DROP TYPE "public"."enum_tenants_socials_mode";`)
}

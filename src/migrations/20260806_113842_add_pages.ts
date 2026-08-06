import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published', 'archived');
  CREATE TYPE "public"."enum_pages_defaults_theme" AS ENUM('inherit', 'light', 'dark');
  CREATE TYPE "public"."enum_pages_defaults_width" AS ENUM('narrow', 'content', 'wide', 'full');
  CREATE TYPE "public"."enum_pages_defaults_padding_y" AS ENUM('none', 'xs', 's', 'm', 'l', 'xl');
  CREATE TYPE "public"."enum_pages_defaults_align" AS ENUM('start', 'center', 'end');
  CREATE TABLE "pages_jurisdictions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL
  );
  
  CREATE TABLE "pages_path_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"path" varchar NOT NULL,
  	"changed_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"path" varchar NOT NULL,
  	"locale" varchar NOT NULL,
  	"site_id" integer NOT NULL,
  	"status" "enum_pages_status" DEFAULT 'draft' NOT NULL,
  	"blocks" jsonb,
  	"defaults_theme" "enum_pages_defaults_theme" DEFAULT 'inherit',
  	"defaults_width" "enum_pages_defaults_width" DEFAULT 'content',
  	"defaults_padding_y" "enum_pages_defaults_padding_y" DEFAULT 'm',
  	"defaults_align" "enum_pages_defaults_align" DEFAULT 'start',
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_canonical" varchar,
  	"seo_og_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pages_id" integer;
  ALTER TABLE "pages_jurisdictions" ADD CONSTRAINT "pages_jurisdictions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_path_history" ADD CONSTRAINT "pages_path_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_tenants_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_seo_og_image_id_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_jurisdictions_order_idx" ON "pages_jurisdictions" USING btree ("_order");
  CREATE INDEX "pages_jurisdictions_parent_id_idx" ON "pages_jurisdictions" USING btree ("_parent_id");
  CREATE INDEX "pages_path_history_order_idx" ON "pages_path_history" USING btree ("_order");
  CREATE INDEX "pages_path_history_parent_id_idx" ON "pages_path_history" USING btree ("_parent_id");
  CREATE INDEX "pages_path_idx" ON "pages" USING btree ("path");
  CREATE INDEX "pages_locale_idx" ON "pages" USING btree ("locale");
  CREATE INDEX "pages_site_idx" ON "pages" USING btree ("site_id");
  CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");
  CREATE INDEX "pages_seo_seo_og_image_idx" ON "pages" USING btree ("seo_og_image_id");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "pages_jurisdictions" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "pages_path_history" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "pages" DISABLE ROW LEVEL SECURITY;
  `)

  /** Связи снимаются до таблиц — причина в [[BUG-003]]. */
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_pages_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_pages_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "pages_id";
    DROP TABLE IF EXISTS "pages_jurisdictions" CASCADE;
    DROP TABLE IF EXISTS "pages_path_history" CASCADE;
    DROP TABLE IF EXISTS "pages" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_pages_status";
    DROP TYPE IF EXISTS "public"."enum_pages_defaults_theme";
    DROP TYPE IF EXISTS "public"."enum_pages_defaults_width";
    DROP TYPE IF EXISTS "public"."enum_pages_defaults_padding_y";
    DROP TYPE IF EXISTS "public"."enum_pages_defaults_align";
  `)
}

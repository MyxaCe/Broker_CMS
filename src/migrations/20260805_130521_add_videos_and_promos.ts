import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_videos_provider" AS ENUM('youtube', 'vimeo', 'self-hosted');
  CREATE TYPE "public"."enum_videos_status" AS ENUM('draft', 'published', 'archived');
  CREATE TYPE "public"."enum_promos_status" AS ENUM('draft', 'published', 'archived');
  CREATE TABLE "videos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"site_id" integer NOT NULL,
  	"description" varchar,
  	"provider" "enum_videos_provider" DEFAULT 'youtube' NOT NULL,
  	"external_id" varchar,
  	"media_id" integer,
  	"poster_id" integer,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"status" "enum_videos_status" DEFAULT 'draft' NOT NULL,
  	"publish_at" timestamp(3) with time zone,
  	"unpublish_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "videos_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"authors_id" integer,
  	"tags_id" integer
  );
  
  CREATE TABLE "promos_jurisdictions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL
  );
  
  CREATE TABLE "promos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"site_id" integer NOT NULL,
  	"badge" varchar,
  	"description" varchar,
  	"terms" varchar NOT NULL,
  	"image_id" integer,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"priority" numeric DEFAULT 0 NOT NULL,
  	"featured" boolean DEFAULT false,
  	"status" "enum_promos_status" DEFAULT 'draft' NOT NULL,
  	"publish_at" timestamp(3) with time zone,
  	"unpublish_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "videos_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "promos_id" integer;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_site_id_tenants_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_authors_fk" FOREIGN KEY ("authors_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promos_jurisdictions" ADD CONSTRAINT "promos_jurisdictions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."promos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promos" ADD CONSTRAINT "promos_site_id_tenants_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "promos" ADD CONSTRAINT "promos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "videos_slug_idx" ON "videos" USING btree ("slug");
  CREATE INDEX "videos_site_idx" ON "videos" USING btree ("site_id");
  CREATE INDEX "videos_media_idx" ON "videos" USING btree ("media_id");
  CREATE INDEX "videos_poster_idx" ON "videos" USING btree ("poster_id");
  CREATE INDEX "videos_starts_at_idx" ON "videos" USING btree ("starts_at");
  CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");
  CREATE INDEX "videos_publish_at_idx" ON "videos" USING btree ("publish_at");
  CREATE INDEX "videos_unpublish_at_idx" ON "videos" USING btree ("unpublish_at");
  CREATE INDEX "videos_updated_at_idx" ON "videos" USING btree ("updated_at");
  CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");
  CREATE INDEX "videos_rels_order_idx" ON "videos_rels" USING btree ("order");
  CREATE INDEX "videos_rels_parent_idx" ON "videos_rels" USING btree ("parent_id");
  CREATE INDEX "videos_rels_path_idx" ON "videos_rels" USING btree ("path");
  CREATE INDEX "videos_rels_authors_id_idx" ON "videos_rels" USING btree ("authors_id");
  CREATE INDEX "videos_rels_tags_id_idx" ON "videos_rels" USING btree ("tags_id");
  CREATE INDEX "promos_jurisdictions_order_idx" ON "promos_jurisdictions" USING btree ("_order");
  CREATE INDEX "promos_jurisdictions_parent_id_idx" ON "promos_jurisdictions" USING btree ("_parent_id");
  CREATE INDEX "promos_slug_idx" ON "promos" USING btree ("slug");
  CREATE INDEX "promos_site_idx" ON "promos" USING btree ("site_id");
  CREATE INDEX "promos_image_idx" ON "promos" USING btree ("image_id");
  CREATE INDEX "promos_priority_idx" ON "promos" USING btree ("priority");
  CREATE INDEX "promos_status_idx" ON "promos" USING btree ("status");
  CREATE INDEX "promos_publish_at_idx" ON "promos" USING btree ("publish_at");
  CREATE INDEX "promos_unpublish_at_idx" ON "promos" USING btree ("unpublish_at");
  CREATE INDEX "promos_updated_at_idx" ON "promos" USING btree ("updated_at");
  CREATE INDEX "promos_created_at_idx" ON "promos" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promos_fk" FOREIGN KEY ("promos_id") REFERENCES "public"."promos"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_videos_id_idx" ON "payload_locked_documents_rels" USING btree ("videos_id");
  CREATE INDEX "payload_locked_documents_rels_promos_id_idx" ON "payload_locked_documents_rels" USING btree ("promos_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "videos_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promos_jurisdictions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promos" DISABLE ROW LEVEL SECURITY;`)

  /** Связи снимаются до таблиц — причина в [[BUG-003]]. */
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_videos_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_promos_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_videos_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_promos_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "videos_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "promos_id";
    DROP TABLE IF EXISTS "videos_rels" CASCADE;
    DROP TABLE IF EXISTS "promos_jurisdictions" CASCADE;
    DROP TABLE IF EXISTS "videos" CASCADE;
    DROP TABLE IF EXISTS "promos" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_videos_provider";
    DROP TYPE IF EXISTS "public"."enum_videos_status";
    DROP TYPE IF EXISTS "public"."enum_promos_status";
  `)
}

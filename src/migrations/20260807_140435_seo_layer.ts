import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_seo_json_ld" AS ENUM('auto', 'article', 'none');
  CREATE TYPE "public"."enum_redirects_status" AS ENUM('301', '302', '410');
  CREATE TABLE "seo_profiles_organization_same_as" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"url" varchar NOT NULL
  );
  
  CREATE TABLE "seo_profiles_disallow_paths" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"path" varchar NOT NULL
  );
  
  CREATE TABLE "seo_profiles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"locale" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"title_template" varchar,
  	"default_description" varchar,
  	"default_og_image_id" integer,
  	"twitter_site" varchar,
  	"organization_name" varchar,
  	"organization_legal_name" varchar,
  	"organization_logo_id" integer,
  	"allow_indexing" boolean DEFAULT false NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "redirects" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"from" varchar NOT NULL,
  	"to" varchar,
  	"status" "enum_redirects_status" DEFAULT '301' NOT NULL,
  	"site_id" integer NOT NULL,
  	"locale" varchar,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "pages" ADD COLUMN "seo_json_ld" "enum_pages_seo_json_ld" DEFAULT 'auto';
  ALTER TABLE "pages" ADD COLUMN "translation_key" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "seo_profiles_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "redirects_id" integer;
  ALTER TABLE "seo_profiles_organization_same_as" ADD CONSTRAINT "seo_profiles_organization_same_as_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."seo_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "seo_profiles_disallow_paths" ADD CONSTRAINT "seo_profiles_disallow_paths_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."seo_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "seo_profiles" ADD CONSTRAINT "seo_profiles_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "seo_profiles" ADD CONSTRAINT "seo_profiles_default_og_image_id_media_id_fk" FOREIGN KEY ("default_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "seo_profiles" ADD CONSTRAINT "seo_profiles_organization_logo_id_media_id_fk" FOREIGN KEY ("organization_logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "redirects" ADD CONSTRAINT "redirects_site_id_tenants_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "seo_profiles_organization_same_as_order_idx" ON "seo_profiles_organization_same_as" USING btree ("_order");
  CREATE INDEX "seo_profiles_organization_same_as_parent_id_idx" ON "seo_profiles_organization_same_as" USING btree ("_parent_id");
  CREATE INDEX "seo_profiles_disallow_paths_order_idx" ON "seo_profiles_disallow_paths" USING btree ("_order");
  CREATE INDEX "seo_profiles_disallow_paths_parent_id_idx" ON "seo_profiles_disallow_paths" USING btree ("_parent_id");
  CREATE INDEX "seo_profiles_owner_idx" ON "seo_profiles" USING btree ("owner_id");
  CREATE INDEX "seo_profiles_locale_idx" ON "seo_profiles" USING btree ("locale");
  CREATE INDEX "seo_profiles_default_og_image_idx" ON "seo_profiles" USING btree ("default_og_image_id");
  CREATE INDEX "seo_profiles_organization_organization_logo_idx" ON "seo_profiles" USING btree ("organization_logo_id");
  CREATE INDEX "seo_profiles_updated_at_idx" ON "seo_profiles" USING btree ("updated_at");
  CREATE INDEX "seo_profiles_created_at_idx" ON "seo_profiles" USING btree ("created_at");
  CREATE INDEX "redirects_from_idx" ON "redirects" USING btree ("from");
  CREATE INDEX "redirects_site_idx" ON "redirects" USING btree ("site_id");
  CREATE INDEX "redirects_updated_at_idx" ON "redirects" USING btree ("updated_at");
  CREATE INDEX "redirects_created_at_idx" ON "redirects" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_seo_profiles_fk" FOREIGN KEY ("seo_profiles_id") REFERENCES "public"."seo_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_redirects_fk" FOREIGN KEY ("redirects_id") REFERENCES "public"."redirects"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_translation_key_idx" ON "pages" USING btree ("translation_key");
  CREATE INDEX "payload_locked_documents_rels_seo_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("seo_profiles_id");
  CREATE INDEX "payload_locked_documents_rels_redirects_id_idx" ON "payload_locked_documents_rels" USING btree ("redirects_id");`)

  /**
   * Один действующий профиль на пару «владелец + язык».
   *
   * Два профиля одного владельца сделали бы выбор умолчаний зависящим от
   * порядка чтения: описание страницы менялось бы от прогона к прогону, а
   * заметить это можно было бы только в выдаче поиска.
   *
   * Уникальность и для перенаправлений: два правила с одного адреса — это
   * выбор без правила. Сборка релиза о таком сообщает, но допускать пару в
   * базе незачем.
   */
  await db.execute(sql`
    CREATE UNIQUE INDEX "seo_profiles_owner_locale_uniq"
      ON "seo_profiles" USING btree ("owner_id", "locale");
    CREATE UNIQUE INDEX "redirects_site_from_locale_uniq"
      ON "redirects" USING btree ("site_id", "from", COALESCE("locale", ''));
  `)
}

/**
 * Порядок обратный порядку создания: внешние ключи и индексы, затем колонки,
 * и только потом таблицы (BUG-003). `IF EXISTS` — чтобы откат частично
 * применённой миграции не спотыкался о недостающий объект.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "seo_profiles_owner_locale_uniq";
  DROP INDEX IF EXISTS "redirects_site_from_locale_uniq";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_seo_profiles_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_redirects_fk";
  DROP INDEX IF EXISTS "pages_translation_key_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_seo_profiles_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_redirects_id_idx";
  ALTER TABLE "pages" DROP COLUMN IF EXISTS "seo_json_ld";
  ALTER TABLE "pages" DROP COLUMN IF EXISTS "translation_key";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "seo_profiles_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "redirects_id";
  ALTER TABLE "seo_profiles_organization_same_as" DROP CONSTRAINT IF EXISTS "seo_profiles_organization_same_as_parent_id_fk";
  ALTER TABLE "seo_profiles_disallow_paths" DROP CONSTRAINT IF EXISTS "seo_profiles_disallow_paths_parent_id_fk";
  ALTER TABLE "seo_profiles" DROP CONSTRAINT IF EXISTS "seo_profiles_owner_id_tenants_id_fk";
  ALTER TABLE "seo_profiles" DROP CONSTRAINT IF EXISTS "seo_profiles_default_og_image_id_media_id_fk";
  ALTER TABLE "seo_profiles" DROP CONSTRAINT IF EXISTS "seo_profiles_organization_logo_id_media_id_fk";
  ALTER TABLE "redirects" DROP CONSTRAINT IF EXISTS "redirects_site_id_tenants_id_fk";
  DROP TABLE IF EXISTS "seo_profiles_organization_same_as" CASCADE;
  DROP TABLE IF EXISTS "seo_profiles_disallow_paths" CASCADE;
  DROP TABLE IF EXISTS "seo_profiles" CASCADE;
  DROP TABLE IF EXISTS "redirects" CASCADE;
  DROP TYPE IF EXISTS "public"."enum_pages_seo_json_ld";
  DROP TYPE IF EXISTS "public"."enum_redirects_status";`)
}

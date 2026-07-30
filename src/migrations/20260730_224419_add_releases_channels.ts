import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_releases_status" AS ENUM('building', 'ready', 'failed');
  CREATE TYPE "public"."enum_channels_name" AS ENUM('live', 'staging');
  CREATE TABLE "releases" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" varchar NOT NULL,
  	"site_slug" varchar NOT NULL,
  	"number" numeric NOT NULL,
  	"label" varchar NOT NULL,
  	"status" "enum_releases_status" DEFAULT 'building' NOT NULL,
  	"snapshot" jsonb,
  	"content_hash" varchar,
  	"validation_report" jsonb,
  	"built_at" timestamp(3) with time zone,
  	"built_by_id" varchar,
  	"built_by_email" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "channels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" varchar NOT NULL,
  	"site_slug" varchar NOT NULL,
  	"name" "enum_channels_name" NOT NULL,
  	"label" varchar NOT NULL,
  	"release_id" varchar,
  	"release_number" numeric,
  	"switched_at" timestamp(3) with time zone,
  	"switched_by_id" varchar,
  	"switched_by_email" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "releases_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "channels_id" integer;
  CREATE INDEX "releases_site_id_idx" ON "releases" USING btree ("site_id");
  CREATE INDEX "releases_site_slug_idx" ON "releases" USING btree ("site_slug");
  CREATE INDEX "releases_number_idx" ON "releases" USING btree ("number");
  CREATE INDEX "releases_status_idx" ON "releases" USING btree ("status");
  CREATE INDEX "releases_content_hash_idx" ON "releases" USING btree ("content_hash");
  CREATE INDEX "releases_updated_at_idx" ON "releases" USING btree ("updated_at");
  CREATE INDEX "releases_created_at_idx" ON "releases" USING btree ("created_at");
  CREATE INDEX "channels_site_id_idx" ON "channels" USING btree ("site_id");
  CREATE INDEX "channels_site_slug_idx" ON "channels" USING btree ("site_slug");
  CREATE INDEX "channels_name_idx" ON "channels" USING btree ("name");
  CREATE INDEX "channels_release_id_idx" ON "channels" USING btree ("release_id");
  CREATE INDEX "channels_updated_at_idx" ON "channels" USING btree ("updated_at");
  CREATE INDEX "channels_created_at_idx" ON "channels" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_releases_fk" FOREIGN KEY ("releases_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_channels_fk" FOREIGN KEY ("channels_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_releases_id_idx" ON "payload_locked_documents_rels" USING btree ("releases_id");
  CREATE INDEX "payload_locked_documents_rels_channels_id_idx" ON "payload_locked_documents_rels" USING btree ("channels_id");`)

  /**
   * Иммутабельность опубликованного на уровне БД (ТЗ разд. 3).
   *
   * Собранный релиз — доказательство того, что было отдано наружу. Правка
   * задним числом обесценивает и его, и весь механизм отката: «вернулись на
   * релиз 41» перестаёт что-либо значить, если 41 с тех пор изменился.
   *
   * Пока релиз собирается, правки разрешены — иначе его нельзя было бы
   * дописать. Замораживание наступает в момент перехода из `building`.
   *
   * Удаление запрещено в том же состоянии: ТЗ требует хранить историю
   * публикаций 7 лет, а история, из которой можно удалить запись, историей
   * не является.
   */
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION releases_immutable_once_built() RETURNS trigger AS $$
    BEGIN
      IF OLD.status <> 'building' THEN
        RAISE EXCEPTION 'release % is immutable once built (status=%): % is not allowed',
          OLD.id, OLD.status, TG_OP
          USING ERRCODE = 'restrict_violation';
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER releases_no_update_once_built
      BEFORE UPDATE ON "releases"
      FOR EACH ROW EXECUTE FUNCTION releases_immutable_once_built();

    CREATE TRIGGER releases_no_delete_once_built
      BEFORE DELETE ON "releases"
      FOR EACH ROW EXECUTE FUNCTION releases_immutable_once_built();
  `)
}

/**
 * Порядок переписан относительно сгенерированного — по причине из BUG-003:
 * генератор ставит `DROP TABLE ... CASCADE` раньше удаления внешних ключей,
 * которые каскад уже снёс, и откат падает.
 *
 * Триггеры снимаются первыми: иначе удаление упрётся в защиту самих релизов.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS releases_no_delete_once_built ON "releases";
    DROP TRIGGER IF EXISTS releases_no_update_once_built ON "releases";
    DROP FUNCTION IF EXISTS releases_immutable_once_built();
  `)

  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_releases_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_channels_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_releases_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_channels_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "releases_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "channels_id";
    DROP TABLE IF EXISTS "releases" CASCADE;
    DROP TABLE IF EXISTS "channels" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_releases_status";
    DROP TYPE IF EXISTS "public"."enum_channels_name";
  `)
}

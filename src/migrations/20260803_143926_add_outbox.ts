import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "outbox" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"routing_key" varchar NOT NULL,
  	"payload" jsonb NOT NULL,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp(3) with time zone NOT NULL,
  	"last_error" varchar,
  	"tenant_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "outbox_id" integer;
  CREATE UNIQUE INDEX "outbox_event_id_idx" ON "outbox" USING btree ("event_id");
  CREATE INDEX "outbox_routing_key_idx" ON "outbox" USING btree ("routing_key");
  CREATE INDEX "outbox_occurred_at_idx" ON "outbox" USING btree ("occurred_at");
  CREATE INDEX "outbox_published_at_idx" ON "outbox" USING btree ("published_at");
  CREATE INDEX "outbox_next_attempt_at_idx" ON "outbox" USING btree ("next_attempt_at");
  CREATE INDEX "outbox_tenant_id_idx" ON "outbox" USING btree ("tenant_id");
  CREATE INDEX "outbox_updated_at_idx" ON "outbox" USING btree ("updated_at");
  CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outbox_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_outbox_id_idx" ON "payload_locked_documents_rels" USING btree ("outbox_id");`)

  /**
   * Частичный индекс по неотправленным (ТЗ 3.5, соглашение платформы ADR-0017).
   *
   * Публикатор выбирает только то, что ещё не ушло и чьё время попытки
   * наступило. Обычный индекс рос бы вместе со всей историей событий, а она
   * не очищается: таблица только пополняется. Частичный содержит ровно очередь
   * на отправку — обычно единицы строк.
   *
   * Добавлено вручную: Payload не выражает условие `WHERE` в описании поля.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx"
      ON "outbox" ("next_attempt_at")
      WHERE "published_at" IS NULL;
  `)
}

/** Порядок переписан относительно сгенерированного — причина в [[BUG-003]]. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "outbox_unpublished_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_outbox_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_outbox_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "outbox_id";
    DROP TABLE IF EXISTS "outbox" CASCADE;
  `)
}

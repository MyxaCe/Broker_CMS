import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_audit_events_action" AS ENUM('create', 'update', 'delete', 'login', 'login-failed', 'access-denied', 'publish', 'rollback', 'approve');
  CREATE TABLE "audit_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"action" "enum_audit_events_action" NOT NULL,
  	"target_collection" varchar NOT NULL,
  	"target_id" varchar,
  	"tenant_id" varchar,
  	"tenant_slug" varchar,
  	"actor_id" varchar,
  	"actor_email" varchar,
  	"actor_role" varchar,
  	"summary" varchar NOT NULL,
  	"changes" jsonb,
  	"request_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_events_id" integer;
  CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
  CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");
  CREATE INDEX "audit_events_target_collection_idx" ON "audit_events" USING btree ("target_collection");
  CREATE INDEX "audit_events_target_id_idx" ON "audit_events" USING btree ("target_id");
  CREATE INDEX "audit_events_tenant_id_idx" ON "audit_events" USING btree ("tenant_id");
  CREATE INDEX "audit_events_actor_id_idx" ON "audit_events" USING btree ("actor_id");
  CREATE INDEX "audit_events_request_id_idx" ON "audit_events" USING btree ("request_id");
  CREATE INDEX "audit_events_updated_at_idx" ON "audit_events" USING btree ("updated_at");
  CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_events_fk" FOREIGN KEY ("audit_events_id") REFERENCES "public"."audit_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_audit_events_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_events_id");`)

  /**
   * Append-only на уровне БД (ТЗ 5.2).
   *
   * Добавлено вручную в ту же миграцию, что создаёт таблицу, намеренно: иначе
   * существует состояние, в котором журнал уже есть, а защиты у него ещё нет.
   * Журнал, который можно поправить, доказательством не является — и особенно
   * опасен именно в это окно, потому что выглядит рабочим.
   *
   * Правило приложения (`access.update/delete → false`) защищает от ошибки в
   * коде. Это правило защищает от обхода приложения: прямого подключения к
   * базе, чужого скрипта, миграции с опечаткой.
   */
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE ON "audit_events"
      FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

    CREATE TRIGGER audit_events_no_delete
      BEFORE DELETE ON "audit_events"
      FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

    CREATE TRIGGER audit_events_no_truncate
      BEFORE TRUNCATE ON "audit_events"
      FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
  `)
}

/**
 * Порядок операций переписан относительно сгенерированного.
 *
 * Генератор ставит `DROP TABLE ... CASCADE` первым, а следом — удаление
 * внешнего ключа, который каскад уже снёс. Откат падает на второй же строке;
 * проверено — сгенерированный вариант не работает.
 *
 * Здесь связи снимаются до таблицы, а триггеры — раньше всего: иначе удаление
 * упрётся в защиту самого журнала.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS audit_events_no_truncate ON "audit_events";
    DROP TRIGGER IF EXISTS audit_events_no_delete ON "audit_events";
    DROP TRIGGER IF EXISTS audit_events_no_update ON "audit_events";
    DROP FUNCTION IF EXISTS audit_events_append_only();
  `)

  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_audit_events_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_audit_events_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "audit_events_id";
    DROP TABLE IF EXISTS "audit_events" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_audit_events_action";
  `)
}

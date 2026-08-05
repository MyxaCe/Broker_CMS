import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Язык записи потока (решение заказчика от 2026-08-05).
 *
 * Сгенерированный вариант добавлял колонку сразу `NOT NULL` и падал бы на
 * любой таблице с данными. Здесь три шага: добавить пустую, заполнить, только
 * потом запретить пустоту.
 *
 * Заполнение — языком по умолчанию у сайта записи, а при его отсутствии `en`.
 * Точность здесь не требуется: продовых данных ещё нет, а записи в
 * разработочных контурах одноязычны. Важно, что миграция не падает и не
 * оставляет колонку без ограничения.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "locale" varchar;
    ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "locale" varchar;
    ALTER TABLE "promos" ADD COLUMN IF NOT EXISTS "locale" varchar;
  `)

  for (const table of ['articles', 'videos', 'promos']) {
    await db.execute(sql`
      UPDATE ${sql.identifier(table)} AS entity
      SET "locale" = COALESCE(
        (SELECT NULLIF(site."default_locale_value", '') FROM "tenants" AS site WHERE site."id" = entity."site_id"),
        'en'
      )
      WHERE entity."locale" IS NULL;
    `)
  }

  await db.execute(sql`
    ALTER TABLE "articles" ALTER COLUMN "locale" SET NOT NULL;
    ALTER TABLE "videos" ALTER COLUMN "locale" SET NOT NULL;
    ALTER TABLE "promos" ALTER COLUMN "locale" SET NOT NULL;
  `)

  /**
   * Индексы составные: лента всегда спрашивает сайт вместе с языком, и
   * отдельный индекс по языку означал бы просмотр всех немецких материалов
   * всех сайтов сразу.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "articles_locale_idx" ON "articles" USING btree ("site_id", "locale");
    CREATE INDEX IF NOT EXISTS "videos_locale_idx" ON "videos" USING btree ("site_id", "locale");
    CREATE INDEX IF NOT EXISTS "promos_locale_idx" ON "promos" USING btree ("site_id", "locale");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "articles_locale_idx";
    DROP INDEX IF EXISTS "videos_locale_idx";
    DROP INDEX IF EXISTS "promos_locale_idx";
    ALTER TABLE "articles" DROP COLUMN IF EXISTS "locale";
    ALTER TABLE "videos" DROP COLUMN IF EXISTS "locale";
    ALTER TABLE "promos" DROP COLUMN IF EXISTS "locale";
  `)
}

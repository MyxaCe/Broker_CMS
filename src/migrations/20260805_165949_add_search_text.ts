import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Полнотекстовый поиск по локали (ТЗ 1.2).
 *
 * Колонка `search_text` собирается приложением; `search_vector` — **генерируемая**
 * колонка, то есть Postgres пересчитывает её сам при каждой записи. Ручное
 * поддержание вектора триггером означало бы третье место, где текст и индекс
 * могут разойтись.
 *
 * Конфигурация разбора выбирается по языку записи ([[ADR-0022]]): без этого
 * русское «ставки» не находится по запросу «ставка», потому что разбор идёт по
 * правилам чужого языка.
 */

/**
 * Выражение вектора. Одно и то же для обеих таблиц — поэтому и вынесено.
 *
 * `to_tsvector(regconfig, text)` в двухаргументной форме **иммутабельна**, и
 * только поэтому её можно использовать в генерируемой колонке. Однoаргументная
 * форма зависит от настройки сессии и была бы отвергнута.
 *
 * `CASE` перечисляет ровно те языки, для которых в Postgres есть словари;
 * остальные получают `simple` — разбор без стемминга. Это хуже правильного
 * словаря, но лучше чужого: чужой даёт не меньше находок, а неверные.
 */
const VECTOR_EXPRESSION = sql`
  to_tsvector(
    CASE split_part("locale", '-', 1)
      WHEN 'en' THEN 'english'::regconfig
      WHEN 'de' THEN 'german'::regconfig
      WHEN 'ru' THEN 'russian'::regconfig
      WHEN 'fr' THEN 'french'::regconfig
      WHEN 'es' THEN 'spanish'::regconfig
      WHEN 'it' THEN 'italian'::regconfig
      WHEN 'pt' THEN 'portuguese'::regconfig
      WHEN 'nl' THEN 'dutch'::regconfig
      WHEN 'tr' THEN 'turkish'::regconfig
      ELSE 'simple'::regconfig
    END,
    coalesce("search_text", '')
  )
`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "search_text" varchar;
    ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "search_text" varchar;
  `)

  await db.execute(sql`
    ALTER TABLE "articles"
      ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (${VECTOR_EXPRESSION}) STORED;
  `)

  await db.execute(sql`
    ALTER TABLE "videos"
      ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (${VECTOR_EXPRESSION}) STORED;
  `)

  /**
   * GIN, а не GiST: поиск здесь читают несравнимо чаще, чем пишут, а GIN
   * быстрее на чтение ценой более дорогой записи.
   *
   * Индекс составной с сайтом и языком: поиск всегда идёт в пределах одного
   * сайта и одного языка, и без них пришлось бы просматривать совпадения по
   * всем сайтам сразу.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "articles_search_idx"
      ON "articles" USING gin ("search_vector");
    CREATE INDEX IF NOT EXISTS "videos_search_idx"
      ON "videos" USING gin ("search_vector");
    CREATE INDEX IF NOT EXISTS "articles_search_scope_idx"
      ON "articles" USING btree ("site_id", "locale");
    CREATE INDEX IF NOT EXISTS "videos_search_scope_idx"
      ON "videos" USING btree ("site_id", "locale");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "articles_search_idx";
    DROP INDEX IF EXISTS "videos_search_idx";
    DROP INDEX IF EXISTS "articles_search_scope_idx";
    DROP INDEX IF EXISTS "videos_search_scope_idx";
    ALTER TABLE "articles" DROP COLUMN IF EXISTS "search_vector";
    ALTER TABLE "videos" DROP COLUMN IF EXISTS "search_vector";
    ALTER TABLE "articles" DROP COLUMN IF EXISTS "search_text";
    ALTER TABLE "videos" DROP COLUMN IF EXISTS "search_text";
  `)
}

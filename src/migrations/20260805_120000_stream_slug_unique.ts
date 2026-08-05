import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Уникальность машинного имени в пределах владельца (ТЗ 1.1).
 *
 * Написана вручную по той же причине, что и уникальность номера релиза:
 * Payload выражает только глобальную уникальность, а она здесь неверна —
 * категория `analytics` обязана существовать у каждого бренда своя.
 *
 * Проверка в приложении недостаточна: между «посмотрели, что свободно» и
 * «записали» помещается второй редактор. Ограничение в БД превращает это в
 * честную ошибку, а не в двойника, который потом всплывает в адресах.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "categories_owner_slug_unique"
      ON "categories" ("owner_id", "slug");
    CREATE UNIQUE INDEX IF NOT EXISTS "tags_owner_slug_unique"
      ON "tags" ("owner_id", "slug");
    CREATE UNIQUE INDEX IF NOT EXISTS "authors_owner_slug_unique"
      ON "authors" ("owner_id", "slug");
  `)

  /**
   * У материала владелец — сайт, а не произвольный узел дерева: адрес
   * материала принадлежит конкретному сайту.
   */
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "articles_site_slug_unique"
      ON "articles" ("site_id", "slug");
  `)

  /**
   * Лента выбирает опубликованное, отсортированное по дате публикации, и
   * почти всегда в пределах одного сайта. Составной индекс покрывает и
   * условие, и порядок — иначе на каждой странице ленты происходит сортировка
   * всей выборки.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "articles_feed_idx"
      ON "articles" ("site_id", "status", "publish_at" DESC);
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "categories_owner_slug_unique";
    DROP INDEX IF EXISTS "tags_owner_slug_unique";
    DROP INDEX IF EXISTS "authors_owner_slug_unique";
    DROP INDEX IF EXISTS "articles_site_slug_unique";
    DROP INDEX IF EXISTS "articles_feed_idx";
  `)
}

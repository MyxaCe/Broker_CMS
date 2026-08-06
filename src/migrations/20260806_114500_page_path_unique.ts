import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Уникальность пути в пределах сайта и языка (ТЗ 2.3).
 *
 * > «path уникален в пределах (сайт, локаль)»
 *
 * Проверка в приложении здесь особенно бесполезна: два редактора сохраняют
 * страницы одновременно, оба видят путь свободным, оба записывают. Дальше на
 * один адрес отвечают две страницы, и какая именно — зависит от порядка
 * чтения. В регулируемом домене это означает, что показанное человеку
 * содержимое невоспроизводимо.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "pages_site_locale_path_unique"
      ON "pages" ("site_id", "locale", "path");
  `)

  /**
   * Выдача ищет страницу по тройке «сайт + язык + путь» и только среди
   * опубликованных. Индекс покрывает запрос целиком.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "pages_lookup_idx"
      ON "pages" ("site_id", "locale", "status");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "pages_site_locale_path_unique";
    DROP INDEX IF EXISTS "pages_lookup_idx";
  `)
}

import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Уникальность пары «сайт + номер релиза» (ТЗ часть 3).
 *
 * Написана вручную: Payload не выражает составную уникальность в описании
 * коллекции, а проверять её в приложении недостаточно. Две одновременные
 * сборки читают максимальный номер, обе получают одно и то же значение и обе
 * его записывают — гонка, которая не воспроизводится в отладке и проявляется
 * ровно тогда, когда публикуют двое сразу.
 *
 * Ограничение в БД превращает эту гонку в честную ошибку у второй сборки.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "releases_site_number_unique"
      ON "releases" ("site_id", "number");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "releases_site_number_unique";
  `)
}

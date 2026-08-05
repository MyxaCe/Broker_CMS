import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Уникальность машинного имени у видео и промо в пределах сайта.
 *
 * Та же причина, что и у материалов: адрес принадлежит сайту, а глобальная
 * уникальность здесь просто неверна.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "videos_site_slug_unique"
      ON "videos" ("site_id", "slug");
    CREATE UNIQUE INDEX IF NOT EXISTS "promos_site_slug_unique"
      ON "promos" ("site_id", "slug");
  `)

  /**
   * Промо выбирается по сайту и сортируется по приоритету, видео — по сайту и
   * времени публикации. Без составных индексов каждая выборка сортирует всё
   * содержимое сайта целиком.
   */
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "promos_board_idx"
      ON "promos" ("site_id", "status", "priority" DESC);
    CREATE INDEX IF NOT EXISTS "videos_feed_idx"
      ON "videos" ("site_id", "status", "publish_at" DESC);
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "videos_site_slug_unique";
    DROP INDEX IF EXISTS "promos_site_slug_unique";
    DROP INDEX IF EXISTS "promos_board_idx";
    DROP INDEX IF EXISTS "videos_feed_idx";
  `)
}

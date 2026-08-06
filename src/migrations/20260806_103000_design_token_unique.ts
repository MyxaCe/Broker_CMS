import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Уникальность имени токена в пределах владельца (ТЗ 2.1).
 *
 * Глобальная уникальность здесь неверна: `accent.default` обязан существовать
 * у каждого бренда свой — в том и смысл наследования.
 *
 * А вот два токена с одним именем **внутри одного узла** — это ошибка:
 * действует только один из них, и какой именно, решает порядок чтения из
 * базы. Разрешение графа такой набор отвергает, но проверка в приложении не
 * спасает от гонки двух редакторов; ограничение в БД спасает.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "design_primitives_owner_name_unique"
      ON "design_primitives" ("owner_id", "name");
    CREATE UNIQUE INDEX IF NOT EXISTS "design_roles_owner_name_unique"
      ON "design_roles" ("owner_id", "name");
    CREATE UNIQUE INDEX IF NOT EXISTS "design_component_tokens_owner_name_unique"
      ON "design_component_tokens" ("owner_id", "name");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "design_primitives_owner_name_unique";
    DROP INDEX IF EXISTS "design_roles_owner_name_unique";
    DROP INDEX IF EXISTS "design_component_tokens_owner_name_unique";
  `)
}

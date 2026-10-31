import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Валюта стартовой суммы демо-счёта (CMS-29, Р-293, Р-435).
 *
 * Второй элемент денежной тройки едет рядом со старым
 * `demo_start_balance_cents`, ничего не снимая: шаг перехода по правилу
 * совместимости (Р-277, Р-293) — новое рядом со старым, потребитель переходит,
 * старое снимается последним.
 *
 * Существующие строки НЕ досчитываются: валюта остаётся `null`. Подставить
 * доллар задним числом значило бы выдать умолчание за решение владельца и
 * вернуть ровно ту случайность, которую CMS-29 чинит (Р-435). Пустая валюта
 * при заданной сумме — отказ на стороне кабинета, а не наша тихая подстановка.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tenants_demo_start_currency_mode" AS ENUM('inherit', 'override', 'fork');
  ALTER TABLE "tenants" ADD COLUMN "demo_start_currency_mode" "enum_tenants_demo_start_currency_mode" DEFAULT 'inherit' NOT NULL;
  ALTER TABLE "tenants" ADD COLUMN "demo_start_currency_value" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tenants" DROP COLUMN "demo_start_currency_mode";
  ALTER TABLE "tenants" DROP COLUMN "demo_start_currency_value";
  DROP TYPE "public"."enum_tenants_demo_start_currency_mode";`)
}

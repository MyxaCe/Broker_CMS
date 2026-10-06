import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_global_areas_variant" AS ENUM('default', 'compact', 'transparent', 'landing');
  CREATE TYPE "public"."enum_global_areas_display_frequency" AS ENUM('once', 'once-per-session', 'once-per-day', 'every-visit');
  ALTER TABLE "global_areas" ADD COLUMN "variant" "enum_global_areas_variant" DEFAULT 'default';
  ALTER TABLE "global_areas" ADD COLUMN "display_delay_seconds" numeric;
  ALTER TABLE "global_areas" ADD COLUMN "display_scroll_percent" numeric;
  ALTER TABLE "global_areas" ADD COLUMN "display_on_exit_intent" boolean DEFAULT false;
  ALTER TABLE "global_areas" ADD COLUMN "display_frequency" "enum_global_areas_display_frequency" DEFAULT 'every-visit';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "global_areas" DROP COLUMN "variant";
  ALTER TABLE "global_areas" DROP COLUMN "display_delay_seconds";
  ALTER TABLE "global_areas" DROP COLUMN "display_scroll_percent";
  ALTER TABLE "global_areas" DROP COLUMN "display_on_exit_intent";
  ALTER TABLE "global_areas" DROP COLUMN "display_frequency";
  DROP TYPE "public"."enum_global_areas_variant";
  DROP TYPE "public"."enum_global_areas_display_frequency";`)
}

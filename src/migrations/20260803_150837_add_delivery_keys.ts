import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_delivery_keys_scopes" AS ENUM('delivery:read', 'preview:read', 'terminal:read');
  CREATE TABLE "delivery_keys_scopes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_delivery_keys_scopes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "delivery_keys" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"key_id" varchar NOT NULL,
  	"secret_hash" varchar NOT NULL,
  	"is_active" boolean DEFAULT true NOT NULL,
  	"expires_at" timestamp(3) with time zone,
  	"last_used_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "delivery_keys_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"tenants_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "delivery_keys_id" integer;
  ALTER TABLE "delivery_keys_scopes" ADD CONSTRAINT "delivery_keys_scopes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."delivery_keys"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "delivery_keys_rels" ADD CONSTRAINT "delivery_keys_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."delivery_keys"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "delivery_keys_rels" ADD CONSTRAINT "delivery_keys_rels_tenants_fk" FOREIGN KEY ("tenants_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "delivery_keys_scopes_order_idx" ON "delivery_keys_scopes" USING btree ("order");
  CREATE INDEX "delivery_keys_scopes_parent_idx" ON "delivery_keys_scopes" USING btree ("parent_id");
  CREATE UNIQUE INDEX "delivery_keys_key_id_idx" ON "delivery_keys" USING btree ("key_id");
  CREATE INDEX "delivery_keys_updated_at_idx" ON "delivery_keys" USING btree ("updated_at");
  CREATE INDEX "delivery_keys_created_at_idx" ON "delivery_keys" USING btree ("created_at");
  CREATE INDEX "delivery_keys_rels_order_idx" ON "delivery_keys_rels" USING btree ("order");
  CREATE INDEX "delivery_keys_rels_parent_idx" ON "delivery_keys_rels" USING btree ("parent_id");
  CREATE INDEX "delivery_keys_rels_path_idx" ON "delivery_keys_rels" USING btree ("path");
  CREATE INDEX "delivery_keys_rels_tenants_id_idx" ON "delivery_keys_rels" USING btree ("tenants_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_delivery_keys_fk" FOREIGN KEY ("delivery_keys_id") REFERENCES "public"."delivery_keys"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_delivery_keys_id_idx" ON "payload_locked_documents_rels" USING btree ("delivery_keys_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "delivery_keys_scopes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "delivery_keys" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "delivery_keys_rels" DISABLE ROW LEVEL SECURITY;`)

  /** Связи снимаются до таблиц — причина в [[BUG-003]]. */
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_delivery_keys_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_delivery_keys_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "delivery_keys_id";
    DROP TABLE IF EXISTS "delivery_keys_scopes" CASCADE;
    DROP TABLE IF EXISTS "delivery_keys_rels" CASCADE;
    DROP TABLE IF EXISTS "delivery_keys" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_delivery_keys_scopes";
  `)
}

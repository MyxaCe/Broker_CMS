import { sql } from '@payloadcms/db-postgres'

import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_design_primitives_category" AS ENUM('color', 'space', 'fontSize', 'fontWeight', 'lineHeight', 'radius', 'shadow', 'duration');
  CREATE TYPE "public"."enum_design_roles_group" AS ENUM('surface', 'text', 'border', 'accent', 'state', 'market');
  CREATE TYPE "public"."enum_design_component_tokens_source" AS ENUM('role', 'primitive');
  CREATE TABLE "design_primitives" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"category" "enum_design_primitives_category" NOT NULL,
  	"value" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "design_roles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"group" "enum_design_roles_group" NOT NULL,
  	"light" varchar NOT NULL,
  	"dark" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "design_component_tokens" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"source" "enum_design_component_tokens_source" DEFAULT 'role' NOT NULL,
  	"reference" varchar NOT NULL,
  	"owner_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "design_primitives_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "design_roles_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "design_component_tokens_id" integer;
  ALTER TABLE "design_primitives" ADD CONSTRAINT "design_primitives_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "design_roles" ADD CONSTRAINT "design_roles_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "design_component_tokens" ADD CONSTRAINT "design_component_tokens_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "design_primitives_name_idx" ON "design_primitives" USING btree ("name");
  CREATE INDEX "design_primitives_category_idx" ON "design_primitives" USING btree ("category");
  CREATE INDEX "design_primitives_owner_idx" ON "design_primitives" USING btree ("owner_id");
  CREATE INDEX "design_primitives_updated_at_idx" ON "design_primitives" USING btree ("updated_at");
  CREATE INDEX "design_primitives_created_at_idx" ON "design_primitives" USING btree ("created_at");
  CREATE INDEX "design_roles_name_idx" ON "design_roles" USING btree ("name");
  CREATE INDEX "design_roles_group_idx" ON "design_roles" USING btree ("group");
  CREATE INDEX "design_roles_owner_idx" ON "design_roles" USING btree ("owner_id");
  CREATE INDEX "design_roles_updated_at_idx" ON "design_roles" USING btree ("updated_at");
  CREATE INDEX "design_roles_created_at_idx" ON "design_roles" USING btree ("created_at");
  CREATE INDEX "design_component_tokens_name_idx" ON "design_component_tokens" USING btree ("name");
  CREATE INDEX "design_component_tokens_owner_idx" ON "design_component_tokens" USING btree ("owner_id");
  CREATE INDEX "design_component_tokens_updated_at_idx" ON "design_component_tokens" USING btree ("updated_at");
  CREATE INDEX "design_component_tokens_created_at_idx" ON "design_component_tokens" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_design_primitives_fk" FOREIGN KEY ("design_primitives_id") REFERENCES "public"."design_primitives"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_design_roles_fk" FOREIGN KEY ("design_roles_id") REFERENCES "public"."design_roles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_design_component_tokens_fk" FOREIGN KEY ("design_component_tokens_id") REFERENCES "public"."design_component_tokens"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_design_primitives_id_idx" ON "payload_locked_documents_rels" USING btree ("design_primitives_id");
  CREATE INDEX "payload_locked_documents_rels_design_roles_id_idx" ON "payload_locked_documents_rels" USING btree ("design_roles_id");
  CREATE INDEX "payload_locked_documents_rels_design_component_tokens_id_idx" ON "payload_locked_documents_rels" USING btree ("design_component_tokens_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "design_primitives" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "design_roles" DISABLE ROW LEVEL SECURITY;
    ALTER TABLE "design_component_tokens" DISABLE ROW LEVEL SECURITY;
  `)

  /** Связи снимаются до таблиц — причина в [[BUG-003]]. */
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_design_primitives_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_design_roles_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_design_component_tokens_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_design_primitives_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_design_roles_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_design_component_tokens_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "design_primitives_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "design_roles_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "design_component_tokens_id";
    DROP TABLE IF EXISTS "design_primitives" CASCADE;
    DROP TABLE IF EXISTS "design_roles" CASCADE;
    DROP TABLE IF EXISTS "design_component_tokens" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_design_primitives_category";
    DROP TYPE IF EXISTS "public"."enum_design_roles_group";
    DROP TYPE IF EXISTS "public"."enum_design_component_tokens_source";
  `)
}

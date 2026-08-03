import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { ensureEnv } from './platform/config'
import { AuditEvents } from './platform/audit/audit.collection'
import { Users } from './platform/auth/users.collection'
import { Tenants } from './platform/tenancy/tenants.collection'
import { Outbox } from './modules/delivery/events/outbox.collection'
import { DeliveryKeys } from './modules/delivery/keys/keys.collection'
import { Channels } from './modules/delivery/releases/channels.collection'
import { Releases } from './modules/delivery/releases/releases.collection'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Конфигурация Payload читается и приложением, и CLI миграций, поэтому
 * окружение проверяется прямо здесь: невалидная конфигурация роняет и то,
 * и другое — одинаково и до любых обращений к БД (fail-closed, ТЗ разд. 3).
 */
const env = ensureEnv()

export default buildConfig({
  serverURL: env.APP_PUBLIC_URL,
  secret: env.PAYLOAD_SECRET,

  admin: {
    user: Users.slug,
  },

  editor: lexicalEditor(),

  collections: [Tenants, Users, Releases, Channels, Outbox, DeliveryKeys, AuditEvents],

  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URL },

    /**
     * ТЗ разд. 13: смешивание dev-push схемы и миграций на одной БД запрещено.
     * `push: false` означает, что схема меняется ТОЛЬКО миграциями — на любой
     * БД, включая локальную. Иначе состояние схемы у разработчика и в проде
     * расходится незаметно, а миграция, которую никто не прогонял локально,
     * впервые исполняется на бою.
     */
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),

  /**
   * ТЗ разд. 13: родной GraphQL фреймворка как вторая дверь к данным запрещён.
   * Отключается целиком, вместе с playground — единственная дверь наружу это
   * версионированный API доставки, каждый ответ которого валидируется схемой.
   */
  graphQL: {
    disable: true,
  },

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

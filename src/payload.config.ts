import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig } from 'payload'

import { ensureEnv } from './platform/config'
import { AuditEvents } from './platform/audit/audit.collection'
import { Users } from './platform/auth/users.collection'
import { Media } from './platform/media/media.collection'
import { Tenants } from './platform/tenancy/tenants.collection'
import { Outbox } from './modules/delivery/events/outbox.collection'
import { DeliveryKeys } from './modules/delivery/keys/keys.collection'
import { Channels } from './modules/delivery/releases/channels.collection'
import { Releases } from './modules/delivery/releases/releases.collection'
import { Articles } from './modules/stream/articles/articles.collection'
import { Promos } from './modules/stream/promo/promos.collection'
import { Authors } from './modules/stream/taxonomy/authors.collection'
import { Categories } from './modules/stream/taxonomy/categories.collection'
import { Tags } from './modules/stream/taxonomy/tags.collection'
import { Videos } from './modules/stream/video/videos.collection'

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

  collections: [
    Tenants,
    Users,
    Media,
    Categories,
    Tags,
    Authors,
    Articles,
    Videos,
    Promos,
    Releases,
    Channels,
    Outbox,
    DeliveryKeys,
    AuditEvents,
  ],

  plugins: [
    /**
     * Файлы лежат в S3-совместимом хранилище (ТЗ 5.3), а не на диске
     * приложения: диск не переживает пересоздание контейнера, а раздача
     * пользовательских файлов тем же процессом, что и админка, — это ещё и
     * лишний способ уронить сервис загрузкой.
     */
    s3Storage({
      collections: { [Media.slug]: true },
      bucket: env.S3_BUCKET,
      config: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        /**
         * MinIO не умеет адресацию по поддомену бакета, а провайдерский S3
         * умеет и то и другое. Значение выбрано по совместимости с обоими.
         */
        forcePathStyle: true,
      },
    }),
  ],

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

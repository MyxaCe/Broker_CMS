import { BRAND_ASSET_SLOTS } from '@/platform'

import { composeBrand } from './compose'

import type { MediaRecord } from './compose'
import type { BrandSnapshot } from './types'
import type { BrandAssetSlot, TenantSettings } from '@/platform'
import type { Payload } from 'payload'

/**
 * Чтение брендовых ассетов на момент сборки релиза (ТЗ 2.1).
 *
 * Разрешение по цепочке уже сделано в `resolveTenantSettings`: сюда приходят
 * победившие ссылки. Здесь остаётся прочитать карточки файлов и собрать
 * адреса — то есть единственное, ради чего нужна база.
 */

/**
 * Публичный адрес файла медиатеки.
 *
 * Собирается из базового адреса хранилища и бакета, а не берётся из поля
 * `url` карточки: Payload кладёт туда свой маршрут `/api/media/file/...`,
 * то есть **относительный адрес на origin админки**. Потребитель живёт на
 * другом домене, и относительный адрес у него не разрешится ни во что; а
 * раздача пользовательских файлов тем же процессом, что и админка, — ровно
 * то, от чего уводит хранение в S3 (ТЗ 5.3).
 *
 * Форма пути — `base/bucket/filename` — верна для адресации по пути, которую
 * включает `forcePathStyle` в конфигурации хранилища. Проверена живым
 * запросом, а не выведена из документации: `.env.example` у нас уже один раз
 * «выглядел как URL», указывая на порт, которого нет.
 */
export function mediaPublicUrl(args: {
  readonly base: string
  readonly bucket: string
  readonly filename: string
}): string {
  const base = args.base.replace(/\/+$/, '')
  const bucket = args.bucket.replace(/^\/+|\/+$/g, '')

  return `${base}/${bucket}/${encodeURIComponent(args.filename)}`
}

export async function loadBrand(args: {
  readonly payload: Payload
  readonly settings: TenantSettings
  readonly mediaBaseUrl: string
  readonly mediaBucket: string
}): Promise<BrandSnapshot> {
  const references = Object.fromEntries(
    BRAND_ASSET_SLOTS.map((slot) => [slot, args.settings.brand.assets[slot].value ?? null]),
  ) as Record<BrandAssetSlot, string | null>

  const ids = [...new Set(Object.values(references).filter((id): id is string => id !== null))]

  const media = new Map<string, MediaRecord>()

  if (ids.length > 0) {
    const found = await args.payload.find({
      collection: 'media',
      where: { id: { in: ids } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })

    for (const doc of found.docs as unknown as Record<string, unknown>[]) {
      media.set(String(doc.id), {
        id: String(doc.id),
        filename: doc.filename,
        width: doc.width,
        height: doc.height,
        mimeType: doc.mimeType,
        alt: doc.alt,
      })
    }
  }

  return composeBrand({
    references,
    media,
    primaryColor: args.settings.brand.primaryColor.value ?? null,
    socials: args.settings.brand.socials.entries.map((entry) => ({
      name: entry.key,
      url: entry.value,
    })),
    publicUrl: (filename) =>
      mediaPublicUrl({ base: args.mediaBaseUrl, bucket: args.mediaBucket, filename }),
  })
}

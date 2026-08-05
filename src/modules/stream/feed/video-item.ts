import { broadcastState } from '../video/broadcast'

import { MappingError, requireText } from './mapper'

import type { BroadcastState } from '../video/broadcast'

/**
 * Элемент ленты видео.
 *
 * Состояние эфира вычисляется **здесь**, в момент сборки ответа, а не берётся
 * из записи: в записи его нет и быть не должно (ТЗ 1.2).
 */

export interface VideoFeedItem {
  readonly slug: string
  readonly title: string
  readonly description: string | null
  readonly publishedAt: string
  readonly provider: string
  /** Идентификатор у внешнего источника либо адрес собственного файла. */
  readonly externalId: string | null
  readonly fileUrl: string | null
  readonly poster: { readonly url: string; readonly alt: string } | null
  readonly broadcast: {
    readonly state: BroadcastState
    readonly startsAt: string | null
    readonly endsAt: string | null
  }
  readonly speakers: readonly { readonly slug: string; readonly title: string }[]
  readonly tags: readonly string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function reference(value: unknown): { slug: string; title: string } | null {
  const record = asRecord(value)

  if (record === null) {
    return null
  }

  const slug = optionalText(record.slug)
  const title = optionalText(record.title)

  return slug === null || title === null ? null : { slug, title }
}

function isoOrNull(value: unknown): string | null {
  const text = optionalText(value)

  if (text === null) {
    return null
  }

  const parsed = Date.parse(text)

  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

export function toVideoFeedItem(doc: Record<string, unknown>, now: Date): VideoFeedItem {
  const slug = requireText(doc.slug, 'машинное имя')
  const title = requireText(doc.title, 'заголовок')
  const publishedAt = requireText(doc.publishAt, 'дата публикации')
  const provider = requireText(doc.provider, 'источник')

  const externalId = optionalText(doc.externalId)
  const file = asRecord(doc.media)
  const fileUrl = file === null ? null : optionalText(file.url)

  /**
   * Ролик, у которого нечего проигрывать, из ленты исключается. Пустой
   * проигрыватель на витрине увидит читатель, а не редактор, — а исключение
   * записи попадёт в алерт и будет замечено.
   */
  if (externalId === null && fileUrl === null) {
    throw new MappingError('Не заполнено обязательное поле: идентификатор ролика или файл')
  }

  const poster = asRecord(doc.poster)
  const posterUrl = poster === null ? null : optionalText(poster.url)
  const posterAlt = poster === null ? null : optionalText(poster.alt)

  return {
    slug,
    title,
    description: optionalText(doc.description),
    publishedAt: new Date(publishedAt).toISOString(),
    provider,
    externalId,
    fileUrl,
    /** Обложка без альтернативного текста не отдаётся — как и у материалов. */
    poster: posterUrl !== null && posterAlt !== null ? { url: posterUrl, alt: posterAlt } : null,
    broadcast: {
      state: broadcastState({ startsAt: doc.startsAt, endsAt: doc.endsAt }, now),
      startsAt: isoOrNull(doc.startsAt),
      endsAt: isoOrNull(doc.endsAt),
    },
    speakers: Array.isArray(doc.speakers)
      ? doc.speakers.flatMap((speaker) => {
          const resolved = reference(speaker)
          return resolved === null ? [] : [resolved]
        })
      : [],
    tags: Array.isArray(doc.tags)
      ? doc.tags.flatMap((tag) => {
          const resolved = reference(tag)
          return resolved === null ? [] : [resolved.slug]
        })
      : [],
  }
}

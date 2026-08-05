/**
 * RSS и Atom на ленту материалов (ТЗ 1.2).
 *
 * Здесь есть тонкость с правилом «каждый ответ валидируется схемой перед
 * отправкой» (ТЗ разд. 3): XML нельзя проверить JSON-схемой.
 *
 * Решение — не исключение из правила, а его сохранение другим путём: лента
 * сериализуется **из уже проверенного** ответа `article-feed.v1`. То есть
 * схему проходит ровно то содержимое, которое попадает в XML; меняется только
 * форма записи. Собирать XML напрямую из базы значило бы завести вторую дверь
 * наружу, мимо контракта.
 */

import type { ArticleFeedResponse } from '@/contracts'

export type SyndicationFormat = 'rss' | 'atom'

export const SYNDICATION_CONTENT_TYPE: Record<SyndicationFormat, string> = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
}

/**
 * Экранирование для XML.
 *
 * Пять сущностей, а не «достаточно трёх»: одинарная и двойная кавычки
 * обязательны в значениях атрибутов, а забытая кавычка ломает документ
 * ровно у того потребителя, который читает его строгим разбором.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Удаляет символы, недопустимые в XML 1.0.
 *
 * Управляющие символы попадают в тексты из копирования из офисных редакторов
 * и делают документ неразбираемым целиком. Экранирование здесь не помогает:
 * такие символы запрещены и в экранированном виде.
 */
export function stripInvalidXml(value: string): string {
  let result = ''

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0

    const allowed =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)

    if (allowed) {
      result += character
    }
  }

  return result
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : escapeXml(stripInvalidXml(value))
}

export interface SyndicationOptions {
  readonly feed: ArticleFeedResponse
  /** Публичный адрес сайта: без него ссылки в ленте некуда вести. */
  readonly siteUrl: string
  readonly title: string
  readonly description?: string | null
  /** Момент сборки. Передаётся, чтобы ответ был воспроизводим в тестах. */
  readonly now: Date
}

function itemUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/news/${slug}`
}

export function renderRss(options: SyndicationOptions): string {
  const { feed } = options
  const self = `${options.siteUrl.replace(/\/+$/, '')}/news`

  const items = feed.items
    .map((item) => {
      const link = itemUrl(options.siteUrl, item.slug)

      return [
        '    <item>',
        `      <title>${text(item.title)}</title>`,
        `      <link>${text(link)}</link>`,
        /**
         * `isPermaLink="false"` — идентификатор не обязан быть адресом. Адрес
         * материала может измениться, а идентификатор в ленте меняться не
         * должен: иначе читалка покажет старый материал как новый.
         */
        `      <guid isPermaLink="false">${text(item.slug)}</guid>`,
        `      <pubDate>${text(new Date(item.publishedAt).toUTCString())}</pubDate>`,
        item.excerpt === null ? '' : `      <description>${text(item.excerpt)}</description>`,
        ...item.authors.map((author) => `      <dc:creator>${text(author.title)}</dc:creator>`),
        item.category === null ? '' : `      <category>${text(item.category.title)}</category>`,
        '    </item>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${text(options.title)}</title>`,
    `    <link>${text(self)}</link>`,
    `    <description>${text(options.description ?? options.title)}</description>`,
    `    <language>${text(feed.resolution.locale)}</language>`,
    `    <lastBuildDate>${text(options.now.toUTCString())}</lastBuildDate>`,
    `    <atom:link href="${text(self)}" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function renderAtom(options: SyndicationOptions): string {
  const { feed } = options
  const self = `${options.siteUrl.replace(/\/+$/, '')}/news`

  const entries = feed.items
    .map((item) => {
      const link = itemUrl(options.siteUrl, item.slug)

      return [
        '  <entry>',
        `    <title>${text(item.title)}</title>`,
        `    <link href="${text(link)}"/>`,
        `    <id>urn:${text(feed.site.slug)}:${text(item.slug)}</id>`,
        `    <updated>${text(item.publishedAt)}</updated>`,
        item.excerpt === null ? '' : `    <summary>${text(item.excerpt)}</summary>`,
        ...item.authors.map((author) => `    <author><name>${text(author.title)}</name></author>`),
        '  </entry>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    })
    .join('\n')

  /**
   * `updated` ленты — время самой свежей записи, а не момент сборки. Иначе
   * читалка считает ленту изменившейся при каждом обращении и перекачивает её
   * целиком.
   */
  const latest = feed.items.reduce<string | null>(
    (newest, item) => (newest === null || item.publishedAt > newest ? item.publishedAt : newest),
    null,
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${text(feed.resolution.locale)}">`,
    `  <title>${text(options.title)}</title>`,
    `  <link href="${text(self)}" rel="self"/>`,
    `  <id>urn:${text(feed.site.slug)}:news</id>`,
    `  <updated>${text(latest ?? options.now.toISOString())}</updated>`,
    entries,
    '</feed>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function renderSyndication(format: SyndicationFormat, options: SyndicationOptions): string {
  return format === 'rss' ? renderRss(options) : renderAtom(options)
}

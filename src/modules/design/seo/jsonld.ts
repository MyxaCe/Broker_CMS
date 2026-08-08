import { collectBlocks } from '../compliance/rules'
import { normalizePath, ROOT_PATH } from '../pages/path'

import type { JsonLdNode, SeoProfileRecord } from './types'

/**
 * Шаблоны JSON-LD по типу страницы (ТЗ 2.3).
 *
 * > «Шаблоны JSON-LD по типу страницы (Organization, FAQPage, Article,
 * > BreadcrumbList)»
 *
 * Разметка **выводится** из страницы, а не заполняется редактором. Причина
 * та же, что у автоматического дисклеймера (ADR-0025): поле, которое надо не
 * забыть заполнить, забывают — и забывают именно там, где оно нужнее всего.
 * А заполненное руками расходится с содержимым страницы при первой же правке
 * и превращается в ложные данные для поисковика.
 */

/** Типы, которые редактор выбирает явно. Остальное выводится. */
export const JSON_LD_KINDS = ['auto', 'article', 'none'] as const

export type JsonLdKind = (typeof JSON_LD_KINDS)[number]

export const JSON_LD_KIND_LABELS: Record<JsonLdKind, string> = {
  auto: 'Автоматически',
  article: 'Статья',
  none: 'Без разметки',
}

export interface JsonLdInput {
  readonly path: string
  readonly title: string
  readonly blocks: unknown
  readonly kind: JsonLdKind
  readonly updatedAt: string
  readonly siteUrl: string | null
  readonly profile: SeoProfileRecord | null
  /** Заголовки страниц сайта по пути — для крошек. */
  readonly titlesByPath: ReadonlyMap<string, string>
}

export function buildJsonLd(input: JsonLdInput): JsonLdNode[] {
  if (input.kind === 'none') {
    return []
  }

  const nodes: JsonLdNode[] = []
  const organization = organizationNode(input)

  /**
   * `Organization` — только на главной. Повторять её на каждой странице
   * значит утверждать, что каждая страница описывает организацию; поисковики
   * это игнорируют, а ошибку в реквизитах приходится править в сотне мест.
   */
  if (organization !== null && normalizePath(input.path) === ROOT_PATH) {
    nodes.push(organization)
  }

  const breadcrumbs = breadcrumbNode(input)

  if (breadcrumbs !== null) {
    nodes.push(breadcrumbs)
  }

  const faq = faqNode(input)

  if (faq !== null) {
    nodes.push(faq)
  }

  if (input.kind === 'article') {
    nodes.push(articleNode(input))
  }

  return nodes
}

function organizationNode(input: JsonLdInput): JsonLdNode | null {
  const organization = input.profile?.organization

  if (organization === null || organization === undefined || organization.name.trim() === '') {
    return null
  }

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: organization.name,
  }

  if (organization.legalName !== null) {
    node.legalName = organization.legalName
  }

  if (input.siteUrl !== null) {
    node.url = input.siteUrl
  }

  if (organization.logo !== null) {
    node.logo = organization.logo
  }

  if (organization.sameAs.length > 0) {
    node.sameAs = [...organization.sameAs]
  }

  return node
}

/**
 * Крошки выводятся из пути.
 *
 * Промежуточный сегмент, у которого нет собственной страницы, всё равно
 * попадает в цепочку — но без ссылки: он существует как раздел, и молчать о
 * нём значило бы показать поисковику разрыв в иерархии.
 */
function breadcrumbNode(input: JsonLdInput): JsonLdNode | null {
  const path = normalizePath(input.path)

  if (path === ROOT_PATH) {
    return null
  }

  const segments = path.split('/').filter((segment) => segment !== '')
  const items: Record<string, unknown>[] = []

  const home = input.titlesByPath.get(ROOT_PATH) ?? 'Главная'
  items.push(listItem(1, home, absolute(input.siteUrl, ROOT_PATH)))

  let current = ''

  segments.forEach((segment, index) => {
    current = `${current}/${segment}`

    const known = input.titlesByPath.get(current)
    const isLeaf = index === segments.length - 1
    const name = known ?? (isLeaf ? input.title : humanize(segment))

    items.push(
      listItem(
        index + 2,
        name,
        known === undefined && !isLeaf ? null : absolute(input.siteUrl, current),
      ),
    )
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  }
}

function listItem(position: number, name: string, url: string | null): Record<string, unknown> {
  const item: Record<string, unknown> = { '@type': 'ListItem', position, name }

  if (url !== null) {
    item.item = url
  }

  return item
}

/**
 * `FAQPage` собирается из блоков `faq` на странице.
 *
 * Ровно то, что имеет в виду ТЗ под «шаблоном по типу страницы»: тип
 * определяется содержимым, а не отдельным полем, которое можно забыть
 * переключить, добавив аккордеон.
 */
function faqNode(input: JsonLdInput): JsonLdNode | null {
  const questions: Record<string, unknown>[] = []

  for (const block of collectBlocks(input.blocks)) {
    if (block.type !== 'faq') {
      continue
    }

    const props = (block.props ?? {}) as Record<string, unknown>
    const items = Array.isArray(props.items) ? props.items : []

    for (const entry of items) {
      if (entry === null || typeof entry !== 'object') {
        continue
      }

      const record = entry as Record<string, unknown>
      const question = typeof record.question === 'string' ? record.question.trim() : ''
      const answer = typeof record.answer === 'string' ? record.answer.trim() : ''

      if (question === '' || answer === '') {
        continue
      }

      questions.push({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })
    }
  }

  if (questions.length === 0) {
    return null
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions,
  }
}

function articleNode(input: JsonLdInput): JsonLdNode {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    dateModified: input.updatedAt,
  }

  const url = absolute(input.siteUrl, input.path)

  if (url !== null) {
    node.mainEntityOfPage = url
  }

  const organization = input.profile?.organization

  if (organization !== null && organization !== undefined && organization.name.trim() !== '') {
    node.publisher = { '@type': 'Organization', name: organization.name }
  }

  return node
}

/**
 * Абсолютный адрес. `null`, если публичный адрес сайта не заполнен: относительная
 * ссылка в JSON-LD не значит ничего, и подставлять её вместо абсолютной значило
 * бы отдать поисковику заведомо неверные данные.
 */
export function absolute(siteUrl: string | null, path: string): string | null {
  if (siteUrl === null) {
    return null
  }

  return `${siteUrl.replace(/\/+$/, '')}${normalizePath(path)}`
}

function humanize(segment: string): string {
  const text = segment.replace(/[-_]+/g, ' ').trim()

  return text === '' ? segment : text.charAt(0).toUpperCase() + text.slice(1)
}

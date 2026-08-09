import { loadTenantChainIds, resolveTenantById } from '@/platform'

import { expandSections, resolveSections } from '../sections/resolve'
import { loadStructure } from '../structure/load'
import { loadTokenSet } from '../tokens/load'

import { normalizePath } from '../pages/path'

import type { PreviewPage } from './PageView'
import type { SectionRecord } from '../sections/resolve'
import type { SnapshotGlobalArea, SnapshotNavigation } from '../structure/types'
import type { Payload } from 'payload'

/**
 * Сбор предпросмотра (ТЗ 5.4).
 *
 * Читает **черновое пространство**, то есть текущее состояние базы, а не
 * снапшот релиза. В этом весь смысл: предпросмотр показывает то, что ещё не
 * опубликовано, — иначе он показывал бы то же, что и витрина, и был бы не нужен.
 */

export interface PreviewResult {
  readonly site: { readonly id: string; readonly slug: string; readonly title: string }
  readonly locale: string
  readonly availableLocales: readonly string[]
  readonly page: PreviewPage | null
  readonly navigation: readonly SnapshotNavigation[]
  readonly areas: readonly SnapshotGlobalArea[]
  readonly tokens: Readonly<Record<string, string>>
  /** Пути опубликованных и черновых страниц — для переключения в предпросмотре. */
  readonly paths: readonly { readonly path: string; readonly title: string }[]
}

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PreviewError'
  }
}

export async function loadPreview(args: {
  readonly payload: Payload
  readonly siteSlug: string
  readonly path: string | null
  readonly locale: string | null
  readonly theme?: 'light' | 'dark'
}): Promise<PreviewResult> {
  const { payload } = args

  const sites = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: args.siteSlug }, kind: { equals: 'site' } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })

  const site = sites.docs[0] as unknown as Record<string, unknown> | undefined

  if (site === undefined) {
    throw new PreviewError('Сайт не найден.', 404)
  }

  const siteId = String(site.id)
  const settings = await resolveTenantById(payload, siteId)
  const availableLocales = settings.availableLocales.entries.map((entry) => entry.value)
  const fallback = settings.defaultLocale.value ?? null

  if (fallback === null) {
    throw new PreviewError('У сайта нет локали по умолчанию — показывать нечего.', 409)
  }

  const locale = args.locale ?? fallback

  /**
   * Неизвестная локаль — отказ, а не молчаливая подмена. То же правило, что и
   * в выдаче (ADR-0003): подмена приводит к тому, что редактор смотрит на
   * немецкую страницу, считая её французской.
   */
  if (!availableLocales.includes(locale)) {
    throw new PreviewError(`Локаль «${locale}» у этого сайта не объявлена.`, 400)
  }

  const chainIds = await loadTenantChainIds(payload, siteId)

  const [{ resolved }, structure, pagesResult, sectionsResult] = await Promise.all([
    loadTokenSet({ payload, siteId }),
    loadStructure({ payload, siteId, locales: [locale] }),
    payload.find({
      collection: 'pages',
      where: { site: { equals: siteId }, locale: { equals: locale } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'sections',
      where: { owner: { in: chainIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ])

  const docs = pagesResult.docs as unknown as Record<string, unknown>[]
  const wanted = args.path === null ? null : normalizePath(args.path)

  const found =
    wanted === null
      ? docs[0]
      : docs.find((doc) => normalizePath(typeof doc.path === 'string' ? doc.path : '') === wanted)

  const theme = args.theme ?? 'light'

  return {
    site: {
      id: siteId,
      slug: typeof site.slug === 'string' ? site.slug : '',
      title: typeof site.name === 'string' ? site.name : '',
    },
    locale,
    availableLocales,
    page: found === undefined ? null : toPreviewPage(found, sectionsResult.docs, locale, chainIds),
    navigation: structure.navigation.filter((menu) => menu.locale === locale),
    areas: structure.globalAreas.filter((area) => area.locale === locale),
    tokens: resolved.byTheme[theme] ?? {},
    paths: docs
      .map((doc) => ({
        path: normalizePath(typeof doc.path === 'string' ? doc.path : ''),
        title: typeof doc.title === 'string' ? doc.title : '',
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

/**
 * Раскрывает секции в дереве страницы — так же, как это сделает сборка релиза.
 *
 * Иначе предпросмотр показал бы ссылку на секцию вместо её содержимого, то
 * есть отличался бы от опубликованной страницы ровно там, где отличаться
 * нельзя.
 */
function toPreviewPage(
  doc: Record<string, unknown>,
  sectionDocs: readonly unknown[],
  locale: string,
  chainIds: readonly string[],
): PreviewPage {
  const records: SectionRecord[] = (sectionDocs as Record<string, unknown>[]).map((section) => ({
    key: typeof section.key === 'string' ? section.key : '',
    locale: typeof section.locale === 'string' ? section.locale : '',
    ownerId: relationId(section.owner),
    isActive: section.isActive === true,
    blocks: section.blocks,
  }))

  const sections = resolveSections({ chainIds, records, locale })
  const expanded = expandSections(doc.blocks, sections)

  return {
    title: typeof doc.title === 'string' ? doc.title : '',
    path: normalizePath(typeof doc.path === 'string' ? doc.path : ''),
    locale,
    status: typeof doc.status === 'string' ? doc.status : 'draft',
    blocks: expanded.blocks,
  }
}

function relationId(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return value === null || value === undefined ? '' : String(value)
}

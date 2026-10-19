import { loadTenantChainIds } from '@/platform'

import { loadSectionRecords } from '../sections/load'
import { expandSections, resolveSections } from '../sections/resolve'

import { collectMediaReferences } from './rules'

import type {
  ComplianceInput,
  CompliancePageInput,
  SectionExpansionIssue,
  RiskWarningArea,
} from './rules'
import type { ResolvedSection } from '../sections/resolve'
import type { Payload } from 'payload'

/**
 * Сбор состояния сайта для комплаенс-проверок (ТЗ 2.4).
 *
 * Читается на момент сборки релиза: проверять надо то, что будет
 * опубликовано, а не то, что было когда-то.
 */

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadComplianceInput(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly jurisdiction: string | null
  readonly locales: readonly string[]
}): Promise<ComplianceInput> {
  const chainIds = await loadTenantChainIds(args.payload, args.siteId)

  /**
   * Страницы берутся **только опубликованные**: черновик в релиз не попадает,
   * и требовать от него комплаенса значило бы мешать работе над материалом,
   * который ещё не показывают.
   */
  const [pagesResult, sectionRecords] = await Promise.all([
    args.payload.find({
      collection: 'pages',
      where: { site: { equals: args.siteId }, status: { equals: 'published' } },
      ...READ,
    }),
    loadSectionRecords({ payload: args.payload, chainIds }),
  ])

  /**
   * Секции разрешаются **по локали страницы** и тем же `resolveSections`,
   * которым пользуется сборка структуры: свой обход цепочки разошёлся бы с
   * движком в наследовании — там, где заметить это труднее всего.
   */
  const sectionsByLocale = new Map<string, ReadonlyMap<string, ResolvedSection>>()

  const sectionsFor = (locale: string): ReadonlyMap<string, ResolvedSection> => {
    const known = sectionsByLocale.get(locale)

    if (known !== undefined) {
      return known
    }

    const resolved = resolveSections({ chainIds, records: sectionRecords, locale })

    sectionsByLocale.set(locale, resolved)

    return resolved
  }

  const sectionIssues: SectionExpansionIssue[] = []

  const pages: CompliancePageInput[] = (
    pagesResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => {
    const path = typeof doc.path === 'string' ? doc.path : ''
    const locale = typeof doc.locale === 'string' ? doc.locale : ''

    /**
     * Главное в DEBT-021: блоки страницы раскрываются **до** проверок.
     *
     * `keepReference` оставляет узел ссылки на месте и кладёт содержимое
     * секции в слот `section:<ключ>` — тогда адрес находки читается как
     * «страница /pricing · blocks[1].slots.section:risks[0].title» и ведёт
     * редактора в секцию, где текст действительно лежит. Обычное раскрытие
     * вклеивает блоки на место ссылки, и адрес указывал бы на блок страницы,
     * которого там нет.
     */
    const expanded = expandSections(doc.blocks, sectionsFor(locale), { keepReference: true })

    for (const issue of expanded.issues) {
      sectionIssues.push({
        code: issue.code,
        location: `страница ${path} (${locale}) → ${issue.path}`,
        message: issue.message,
      })
    }

    return {
      path,
      locale,
      blocks: expanded.blocks,
      jurisdictions: Array.isArray(doc.jurisdictions)
        ? (doc.jurisdictions as Record<string, unknown>[]).flatMap((entry) =>
            typeof entry.code === 'string' ? [entry.code] : [],
          )
        : [],
    }
  })

  /**
   * Полосы предупреждения ищутся по всей цепочке наследования: область бренда
   * действует на его сайтах, и требовать собственную полосу у каждого сайта
   * значило бы заводить двадцать копий одного регуляторного текста.
   */
  const areasResult = await args.payload.find({
    collection: 'global-areas',
    where: { owner: { in: chainIds }, kind: { equals: 'risk-warning' } },
    ...READ,
  })

  const riskWarnings: RiskWarningArea[] = (
    areasResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => {
    const warning = (doc.riskWarning ?? {}) as Record<string, unknown>

    return {
      isActive: doc.isActive === true,
      text: typeof warning.text === 'string' ? warning.text : null,
      lossPercentage: typeof warning.lossPercentage === 'number' ? warning.lossPercentage : null,
      locale: typeof doc.locale === 'string' ? doc.locale : '',
    }
  })

  return {
    jurisdiction: args.jurisdiction,
    locales: args.locales,
    riskWarnings,
    pages,
    /**
     * Картинки ищутся в **раскрытом** дереве: изображение без `alt` внутри
     * переиспользуемой секции — такое же нарушение, как на самой странице.
     */
    mediaAlt: await loadMediaAlt(args.payload, pages),
    sectionIssues,
  }
}

/**
 * Узнаёт, у каких изображений заполнен alt.
 *
 * Запрашиваются только те файлы, на которые ссылаются страницы: медиатека
 * бывает большой, и проверять её целиком незачем — не использованный файл
 * ничего не нарушает.
 */
async function loadMediaAlt(
  payload: Payload,
  pages: readonly CompliancePageInput[],
): Promise<Map<string, boolean>> {
  const ids = new Set<string>()

  for (const page of pages) {
    for (const reference of collectMediaReferences(page.blocks)) {
      ids.add(reference.id)
    }
  }

  const result = new Map<string, boolean>()

  if (ids.size === 0) {
    return result
  }

  const found = await payload.find({
    collection: 'media',
    where: { id: { in: [...ids] } },
    ...READ,
  })

  for (const doc of found.docs as unknown as Record<string, unknown>[]) {
    result.set(String(doc.id), typeof doc.alt === 'string' && doc.alt.trim() !== '')
  }

  /**
   * Ссылка на несуществующий файл считается изображением без alt: показать
   * такое изображение всё равно не получится, и молчать об этом хуже, чем
   * сообщить не самой точной формулировкой.
   */
  for (const id of ids) {
    if (!result.has(id)) {
      result.set(id, false)
    }
  }

  return result
}

import {
  collectContrastPairs,
  collectTexts,
  loadComplianceInput,
  loadRouting,
  loadStructure,
  loadTokenSet,
  runComplianceRules,
} from '@/modules/design'
import { resolveAllowList } from '@/modules/trading'
import { resolveTenantById, runValidation, summarizeReport } from '@/platform'

import { contentHash } from '../cache-key'

import { nextReleaseNumber } from './numbering'
import { composeSnapshot } from './snapshot'
import { RELEASE_VALIDATORS } from './validators'

import type { ReleaseSnapshot } from './snapshot'
import type { ValidationReport } from '@/platform'
import type { Payload, PayloadRequest } from 'payload'

/**
 * Сборка релиза (ТЗ часть 3).
 *
 * Порядок операций определяет всё остальное:
 *
 *  1. занять номер записью в состоянии `building` — до того, как что-то считать;
 *  2. собрать снапшот;
 *  3. прогнать валидаторы;
 *  4. перевести в `ready` или `failed` вместе с отчётом.
 *
 * Номер занимается **первым** намеренно: две одновременные сборки не должны
 * получить один номер. Уникальность пары «сайт + номер» стоит на уровне БД,
 * поэтому вторая попытка упрётся в ограничение, а не создаст двойника.
 */

export interface BuildReleaseResult {
  readonly releaseId: number | string
  readonly number: number
  readonly status: 'ready' | 'failed'
  readonly report: ValidationReport
  readonly snapshot: ReleaseSnapshot
}

export interface BuildReleaseArgs {
  readonly payload: Payload
  readonly siteId: number | string
  readonly actor?: { readonly id: string | null; readonly email: string | null }
  readonly req?: PayloadRequest
}

async function takeNextNumber(payload: Payload, siteId: string): Promise<number> {
  const existing = await payload.find({
    collection: 'releases',
    where: { siteId: { equals: siteId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  return nextReleaseNumber(existing.docs.map((doc) => Number(doc.number)))
}

export async function buildRelease(args: BuildReleaseArgs): Promise<BuildReleaseResult> {
  const { payload } = args
  const siteId = String(args.siteId)

  const site = (await payload.findByID({
    collection: 'tenants',
    id: args.siteId,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>

  const siteSlug = typeof site.slug === 'string' ? site.slug : ''
  const number = await takeNextNumber(payload, siteId)

  /**
   * Запись создаётся до сборки: номер занят, и в списке релизов видно, что
   * сборка идёт. Незавершённая сборка, о которой нигде нет следа, — это
   * ситуация, в которой невозможно понять, что происходит.
   */
  const release = await payload.create({
    collection: 'releases',
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: {
      siteId,
      siteSlug,
      number,
      label: `${siteSlug} #${number}`,
      status: 'building',
      builtById: args.actor?.id ?? null,
      builtByEmail: args.actor?.email ?? null,
    } as never,
  })

  const settings = await resolveTenantById(payload, args.siteId)

  /**
   * Токены разрешаются на момент сборки и **замораживаются** в снапшоте.
   * Читать их при выдаче значило бы, что откат вернёт старую разметку с
   * новыми цветами — то есть состояние, которого никогда не публиковали.
   */
  const { resolved } = await loadTokenSet({ payload, siteId: args.siteId })

  /**
   * Комплаенс проверяется по состоянию на момент сборки: страницы, области и
   * файлы читаются здесь, а не при выдаче. Иначе релиз, собранный вчера, мог
   * бы стать нарушением сегодня — от правки, которой никто не публиковал.
   */
  const locales = settings.availableLocales.entries.map((entry) => entry.value)

  const complianceInput = await loadComplianceInput({
    payload,
    siteId: args.siteId,
    jurisdiction: settings.jurisdiction.value ?? null,
    locales,
  })

  /**
   * Навигация и глобальные области разрешаются здесь же и замораживаются в
   * снапшоте. Дотягивать их при выдаче значило бы, что вчерашний релиз меняется
   * от сегодняшней правки меню — то есть перестаёт что-либо обещать.
   */
  const structure = await loadStructure({ payload, siteId: args.siteId, locales })

  /**
   * Слой В читается здесь же — и это единственное чтение сборки, выходящее за
   * пределы своего сайта: граф hreflang по определению связывает языковые
   * версии, живущие на разных сайтах бренда (ТЗ 2.3).
   */
  const routing = await loadRouting({ payload, siteId: args.siteId, locales })

  /**
   * Разрешённые инструменты (Р-026) читаются здесь и замораживаются вместе с
   * релизом. Обращения к MDS на этом шаге нет и быть не может: сборка читает
   * нашу карточку доступа, а котируемость проверена заранее — при её
   * сохранении, против локального снимка вселенной (ТЗ 4.2).
   */
  const instruments = await resolveAllowList(payload, args.siteId)

  /**
   * Тексты для стоп-словаря (ТЗ 2.4).
   *
   * Собираются из того же набора страниц, что проверяет комплаенс, — из
   * `complianceInput`, а не отдельным чтением базы. Второй обход разошёлся бы
   * с первым в отборе черновиков, и разошёлся бы незаметно: стоп-словарь ходил
   * бы по одному набору страниц, а гейт риск-предупреждения — по другому.
   *
   * Полоса риск-предупреждения и cookie-баннер относятся к классу
   * `compliance`: их формулировки согласованы, и обещание доходности там —
   * не редакторская вольность, а правка согласованного текста.
   */
  const texts = [
    ...complianceInput.pages.flatMap((page) =>
      collectTexts(page.blocks, {
        location: `страница ${page.path} (${page.locale})`,
        contentClass: 'marketing',
      }),
    ),
    ...structure.globalAreas.flatMap((area) =>
      collectTexts(area.blocks, {
        location: `область «${area.kind}» (${area.locale})`,
        contentClass:
          area.kind === 'risk-warning' || area.kind === 'cookie-banner'
            ? 'compliance'
            : 'marketing',
      }),
    ),
    /**
     * Текст самой полосы риск-предупреждения живёт отдельным полем, а не
     * блоком, и через обход дерева не проходит. Пропустить его было бы
     * особенно неудачно: это единственный текст на сайте, который читает
     * регулятор.
     */
    ...structure.globalAreas.flatMap((area) =>
      area.riskWarning === null || area.riskWarning.text.trim() === ''
        ? []
        : [
            {
              location: `полоса риск-предупреждения (${area.locale})`,
              contentClass: 'compliance' as const,
              text: area.riskWarning.text,
            },
          ],
    ),
  ]

  const snapshot = composeSnapshot(
    {
      id: siteId,
      slug: siteSlug,
      kind:
        site.kind === 'brand' || site.kind === 'region' || site.kind === 'site'
          ? site.kind
          : 'site',
      parentId: null,
    },
    settings,
    {
      colorPairs: collectContrastPairs(resolved),
      tokenIssues: resolved.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
      })),
      tokens: resolved.byTheme,
      complianceFindings: runComplianceRules(complianceInput),
      structure,
      routing,
      texts,
      instruments: {
        symbols: instruments.symbols,
        configured: instruments.configured,
        confirmedUnquoted: instruments.confirmedUnquoted.map((entry) => ({
          symbol: entry.symbol,
          standing: entry.standing,
        })),
      },
      /**
       * Сколько материала осмотрено. Числа передаются явно, чтобы отчёт
       * различал «нарушений нет» и «проверять было нечего»: по пустому списку
       * находок валидатор-ретранслятор отличить одно от другого не может, и
       * именно на этом стоп-словарь месяц выглядел пройденным (DEBT-013).
       */
      examined: {
        tokens: Object.values(resolved.byTheme).reduce(
          (total, theme) => total + Object.keys(theme).length,
          0,
        ),
        structureNodes: structure.navigation.length + structure.globalAreas.length,
        routedPages: routing.pages.length,
        compliancePages: complianceInput.pages.length,
      },
    },
  )

  const report = runValidation(RELEASE_VALIDATORS, snapshot)
  const status = report.passed ? 'ready' : 'failed'

  /**
   * Отчёт сохраняется в обоих случаях. У проваленной сборки он даже важнее:
   * это единственное объяснение, почему релиз не собрался, и оно замораживается
   * вместе с записью (ADR-0015).
   */
  await payload.update({
    collection: 'releases',
    id: release.id,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: {
      status,
      builtAt: new Date().toISOString(),
      snapshot: report.passed ? snapshot : null,
      contentHash: report.passed ? contentHash(snapshot) : null,
      validationReport: {
        summary: summarizeReport(report),
        passed: report.passed,
        findings: report.findings,
        byValidator: report.byValidator,
      },
    } as never,
  })

  return { releaseId: release.id, number, status, report, snapshot }
}

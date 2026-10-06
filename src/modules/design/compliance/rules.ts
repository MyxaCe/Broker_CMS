import { BLOCK_PROPS } from '../blocks/registry-props'

import { requirementsFor } from './jurisdictions'

import type { PropField } from '../blocks/props'

/**
 * Комплаенс-ограничители (ТЗ 2.4).
 *
 * > «Эти правила — часть движка, а не поля в форме»
 *
 * Здесь чистые функции: на вход — состояние сайта на момент сборки, на выход
 * — список нарушений. Прогоняет их валидатор сборки релиза, и непустой список
 * означает, что релиз не собирается.
 */

export interface ComplianceFinding {
  readonly code:
    | 'risk-warning-missing'
    | 'risk-warning-empty'
    | 'loss-percentage-missing'
    | 'image-without-alt'
    | 'forbidden-block'
    | 'unreachable-jurisdiction'
    | 'disclaimer-missing'
  readonly message: string
  readonly location: string
}

/** Область риск-предупреждения в том виде, в каком её видит проверка. */
export interface RiskWarningArea {
  readonly isActive: boolean
  readonly text: string | null
  readonly lossPercentage: number | null
  readonly locale: string
}

export interface CompliancePageInput {
  readonly path: string
  readonly locale: string
  readonly blocks: unknown
  readonly jurisdictions: readonly string[]
}

export interface ComplianceInput {
  /** Юрисдикция сайта, разрешённая по цепочке наследования. */
  readonly jurisdiction: string | null
  /** Локали, объявленные у сайта. Предупреждение нужно на каждой. */
  readonly locales: readonly string[]
  readonly riskWarnings: readonly RiskWarningArea[]
  readonly pages: readonly CompliancePageInput[]
  /** Идентификатор медиа → есть ли непустой alt. */
  readonly mediaAlt: ReadonlyMap<string, boolean>
}

/**
 * Проверяет наличие риск-предупреждения (ТЗ 2.4).
 *
 * > «страница не может быть опубликована без глобальной области риск-варнинга»
 *
 * Проверяется **на каждую локаль сайта**: предупреждение, существующее только
 * по-английски, не выполняет своей задачи на немецкой версии — его там просто
 * не прочитают.
 */
export function checkRiskWarning(input: ComplianceInput): ComplianceFinding[] {
  const requirements = requirementsFor(input.jurisdiction)

  if (!requirements.riskWarningRequired) {
    return []
  }

  const findings: ComplianceFinding[] = []
  const active = input.riskWarnings.filter((area) => area.isActive)

  /**
   * Пустой список локалей — отдельный случай: проверять нечего, но и молчать
   * нельзя. О самом отсутствии локалей сообщит валидатор готовности сайта,
   * поэтому здесь достаточно не выдумывать несуществующие проверки.
   */
  for (const locale of input.locales) {
    const area = active.find((candidate) => candidate.locale === locale)

    if (area === undefined) {
      findings.push({
        code: 'risk-warning-missing',
        message: `Юрисдикция «${requirements.title}» требует постоянного предупреждения о риске, а для локали «${locale}» действующей полосы нет.`,
        location: `локаль: ${locale}`,
      })
      continue
    }

    /** Пустая полоса — не предупреждение, а место, где оно должно было быть. */
    if (area.text === null || area.text.trim() === '') {
      findings.push({
        code: 'risk-warning-empty',
        message: `Полоса риск-предупреждения для локали «${locale}» существует, но текст не заполнен.`,
        location: `локаль: ${locale}`,
      })
      continue
    }

    if (
      requirements.lossPercentageRequired &&
      (area.lossPercentage === null || Number.isNaN(area.lossPercentage))
    ) {
      findings.push({
        code: 'loss-percentage-missing',
        message: `Юрисдикция «${requirements.title}» требует указывать долю теряющих счетов рядом с предупреждением; для локали «${locale}» она не заполнена.`,
        location: `локаль: ${locale}`,
      })
    }
  }

  return findings
}

/**
 * Обязательный alt у каждого изображения (ТЗ 2.4, 5.3).
 *
 * > «Нет alt — релиз не собирается»
 *
 * Проверка на сборке нужна, хотя alt обязателен и в форме медиатеки: файл мог
 * быть загружен до появления правила или прийти импортом, а страница ссылается
 * на него сегодня.
 */
export function checkImageAlt(input: ComplianceInput): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []

  for (const page of input.pages) {
    for (const reference of collectMediaReferences(page.blocks)) {
      const hasAlt = input.mediaAlt.get(reference.id)

      if (hasAlt === false) {
        findings.push({
          code: 'image-without-alt',
          message:
            'У изображения не заполнен альтернативный текст. Без него содержимое недоступно тем, кто читает страницу голосом.',
          location: `${page.path} → ${reference.path}`,
        })
      }
    }
  }

  return findings
}

/**
 * Юрисдикционная видимость (ТЗ 2.4).
 *
 * Два разных нарушения:
 *
 *  · **запрещённый блок** — продукт, недопустимый в юрисдикции, не должен
 *    рендериться вовсе;
 *  · **недостижимое ограничение** — блок или страница ограничены юрисдикциями,
 *    среди которых нет юрисдикции сайта. Такое содержимое не покажется никогда,
 *    и это почти всегда опечатка, а не замысел.
 */
export function checkJurisdictionVisibility(input: ComplianceInput): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []
  const site = input.jurisdiction
  const requirements = requirementsFor(site)

  for (const page of input.pages) {
    if (site !== null && page.jurisdictions.length > 0 && !page.jurisdictions.includes(site)) {
      findings.push({
        code: 'unreachable-jurisdiction',
        message: `Страница ограничена юрисдикциями (${page.jurisdictions.join(', ')}), среди которых нет юрисдикции сайта «${site}» — она не откроется никогда.`,
        location: page.path,
      })
    }

    for (const node of collectBlocks(page.blocks)) {
      if (requirements.forbiddenBlocks.includes(node.type)) {
        findings.push({
          code: 'forbidden-block',
          message: `Блок «${node.type}» запрещён в юрисдикции «${requirements.title}».`,
          location: `${page.path} → ${node.path}`,
        })
      }

      if (site !== null && node.jurisdictions.length > 0 && !node.jurisdictions.includes(site)) {
        findings.push({
          code: 'unreachable-jurisdiction',
          message: `Блок ограничен юрисдикциями (${node.jurisdictions.join(', ')}), среди которых нет юрисдикции сайта «${site}» — он не отрисуется никогда.`,
          location: `${page.path} → ${node.path}`,
        })
      }
    }
  }

  return findings
}

export function runComplianceRules(input: ComplianceInput): ComplianceFinding[] {
  return [
    ...checkRiskWarning(input),
    ...checkImageAlt(input),
    ...checkJurisdictionVisibility(input),
  ]
}

export interface FlatBlock {
  readonly type: string
  readonly path: string
  readonly jurisdictions: readonly string[]
  /**
   * Пропсы блока как есть. Нужны тем, кто читает содержимое, а не только
   * состав дерева: разметке JSON-LD, извлечению текстов для стоп-словаря.
   * Обход дерева должен быть один — второй разошёлся бы с этим в обработке
   * вложенности, и разошёлся бы незаметно.
   */
  readonly props: unknown
}

/**
 * Разворачивает дерево в плоский список.
 *
 * Обходит и вложенные блоки: правило, действующее только на верхнем уровне,
 * обходится переносом блока в колонку.
 */
export function collectBlocks(blocks: unknown, prefix = 'blocks'): FlatBlock[] {
  if (!Array.isArray(blocks)) {
    return []
  }

  const found: FlatBlock[] = []

  blocks.forEach((node, index) => {
    if (node === null || typeof node !== 'object') {
      return
    }

    const record = node as Record<string, unknown>
    const path = `${prefix}[${index}]`
    const type = typeof record.type === 'string' ? record.type : ''

    const visibility = record.visibility
    const jurisdictions =
      visibility !== null && typeof visibility === 'object'
        ? toCodes((visibility as Record<string, unknown>).jurisdictions)
        : []

    found.push({ type, path, jurisdictions, props: record.props })

    const slots = record.slots

    if (slots !== null && typeof slots === 'object' && !Array.isArray(slots)) {
      for (const [slot, children] of Object.entries(slots as Record<string, unknown>)) {
        found.push(...collectBlocks(children, `${path}.slots.${slot}`))
      }
    }
  })

  return found
}

interface MediaReference {
  readonly id: string
  readonly path: string
}

/**
 * Имена полей, которые считаются ссылкой на медиатеку.
 *
 * Собираются **из реестра пропсов**, а не перечисляются руками. Руками было
 * ровно до `2026-10-06`, и список отставал: из восьми полей вида `media` в
 * реестре в нём было пять — `icon`, `avatar` и `file` проверка alt не видела
 * вовсе. Правило работало, объявляло охват и молча осматривало меньше, чем
 * заявляло.
 *
 * Имена, которых в реестре нет, оставлены сверху списком: описание типа
 * покрывает только известные типы, а дерево переживает переименование блока и
 * приходит из поля JSON. Пропустить картинку из-за незнакомого типа хуже, чем
 * лишний раз заглянуть в поле, которого нет.
 */
const LEGACY_MEDIA_FIELD_NAMES = ['images', 'cover', 'logo', 'logos', 'media'] as const

export function mediaPropNames(): ReadonlySet<string> {
  const names = new Set<string>(LEGACY_MEDIA_FIELD_NAMES)

  const walk = (fields: readonly PropField[]): void => {
    for (const field of fields) {
      if (field.kind === 'media') {
        names.add(field.name)
      }

      if (field.of !== undefined) {
        walk(field.of)
      }
    }
  }

  for (const fields of Object.values(BLOCK_PROPS)) {
    walk(fields)
  }

  return names
}

/**
 * Собирает ссылки на медиа из дерева.
 *
 * Ищет по имени поля в пропсах: конкретные имена у типов разные, а дерево
 * приходит из поля JSON и может содержать блок типа, которого в реестре уже
 * нет.
 */
export function collectMediaReferences(blocks: unknown, prefix = 'blocks'): MediaReference[] {
  const MEDIA_FIELDS = mediaPropNames()
  const found: MediaReference[] = []

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`)
      })
      return
    }

    if (value === null || typeof value !== 'object') {
      return
    }

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (MEDIA_FIELDS.has(key)) {
        for (const id of toIds(nested)) {
          found.push({ id, path: `${path}.${key}` })
        }

        continue
      }

      walk(nested, `${path}.${key}`)
    }
  }

  walk(blocks, prefix)

  return found
}

function toIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => toIds(item))
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return [String(value)]
  }

  if (value !== null && typeof value === 'object' && 'id' in value) {
    return [String((value as { id: unknown }).id)]
  }

  return []
}

function toCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      return [item]
    }

    if (item !== null && typeof item === 'object' && 'code' in item) {
      const code = (item as { code: unknown }).code
      return typeof code === 'string' ? [code] : []
    }

    return []
  })
}

/**
 * Дисклеймер продукта прикрепляется к типу блока правилом, а не вручную
 * (ТЗ 2.4).
 *
 * Ручное прикрепление означает, что рано или поздно его забудут — и забудут
 * именно там, где он нужнее всего, потому что таких блоков на сайте десятки.
 */
export const BLOCK_DISCLAIMERS: Readonly<Record<string, string>> = {
  calculator: 'disclaimer.calculator',
  'instruments-table': 'disclaimer.trading-conditions',
  'instrument-card': 'disclaimer.trading-conditions',
  'pricing-grid': 'disclaimer.trading-conditions',
  'account-types': 'disclaimer.trading-conditions',
  'comparison-table': 'disclaimer.trading-conditions',
  'quote-ticker': 'disclaimer.market-data',
  'economic-calendar': 'disclaimer.market-data',
}

/**
 * Плоского списка ключей на страницу здесь больше нет, и это решение.
 *
 * `requiredDisclaimers` возвращала именно его — и ровно эту форму штаб
 * отверг правкой к Р-028: плоский список теряет связь «этот дисклеймер про
 * этот калькулятор», а она может быть требованием регулятора. Вывод ключей
 * живёт в `disclaimers/compose.ts` и возвращает их **при блоке**.
 *
 * Функция удалена, а не оставлена «на всякий случай», в том же заходе, что и
 * замена: вытесненная и никем не вызываемая, она через месяц неотличима от
 * той самой невызываемой проверки, из-за которой правило дисклеймеров прожило
 * месяц невыполненным (BUG-010). Экспорт, у которого в поиске вызовов только
 * тесты, — наш опознанный признак, а не догадка.
 */

import { findBlock } from '../blocks/registry'
import { BLOCK_DISCLAIMERS, collectBlocks } from '../compliance/rules'

import type { DisclaimerFinding, DisclaimersSnapshot, PageDisclaimers } from './types'

/**
 * Вывод требуемых дисклеймеров из состава блоков и сверка их с текстами
 * (ТЗ 2.4, Р-028).
 *
 * Функции чистые: страницы, области и тексты приходят готовыми. Это
 * единственный способ проверить инвариант «ключ без текста не собирается» на
 * всех его гранях, не поднимая базу.
 */

export interface DisclaimerSourcePage {
  readonly path: string
  readonly locale: string
  readonly blocks: unknown
}

export interface DisclaimerSourceArea {
  readonly kind: string
  readonly locale: string
  readonly blocks: unknown
}

export interface DisclaimerText {
  readonly key: string
  readonly locale: string
  readonly text: string
}

export interface ComposeDisclaimersArgs {
  readonly pages: readonly DisclaimerSourcePage[]
  /**
   * Глобальные области сайта, разрешённые по цепочке. Их блоки дают ключи
   * **страницы целиком**: шапка показывается на каждой, и привязать её тикер
   * к блоку конкретной страницы нельзя.
   */
  readonly areas: readonly DisclaimerSourceArea[]
  readonly texts: readonly DisclaimerText[]
}

/**
 * Ключи, выведенные из одного дерева блоков, — **при блоках**.
 *
 * Блок, которого нет в реестре, ключа не даёт: его состав нам неизвестен, и
 * утверждать, что ему нужен дисклеймер, мы не можем. О самом неизвестном
 * типе сообщит проверка дерева блоков — это её работа, а не наша.
 */
function keysByBlock(blocks: unknown): PageDisclaimers['blocks'] {
  const found: { path: string; type: string; keys: string[] }[] = []

  for (const node of collectBlocks(blocks)) {
    const key = BLOCK_DISCLAIMERS[node.type]

    if (key === undefined || findBlock(node.type) === undefined) {
      continue
    }

    found.push({ path: node.path, type: node.type, keys: [key] })
  }

  return found
}

function keysOf(entry: PageDisclaimers): string[] {
  return [...new Set([...entry.page, ...entry.blocks.flatMap((block) => block.keys)])].sort()
}

export function composeDisclaimers(args: ComposeDisclaimersArgs): DisclaimersSnapshot {
  /** Локаль → ключ → текст. Пустой текст в карту не попадает — см. ниже. */
  const texts: Record<string, Record<string, string>> = {}
  const findings: DisclaimerFinding[] = []

  for (const entry of args.texts) {
    if (entry.text.trim() === '') {
      /**
       * Пустой текст — не текст. Ключ, у которого есть запись с пустым
       * текстом, выглядит заполненным в списке коллекции и пустым местом на
       * витрине; это худший из трёх исходов, потому что проходит и проверку,
       * и беглый взгляд редактора.
       */
      findings.push({
        code: 'disclaimer-text-empty',
        message: `Дисклеймер «${entry.key}» для локали «${entry.locale}» заведён, но текст не заполнен. Пустой дисклеймер выглядит на витрине выполненным требованием и им не является.`,
        location: `${entry.key} (${entry.locale})`,
      })
      continue
    }

    texts[entry.locale] = { ...texts[entry.locale], [entry.key]: entry.text.trim() }
  }

  /** Ключи глобальных областей — по локали области. */
  const areaKeysByLocale = new Map<string, Set<string>>()

  for (const area of args.areas) {
    const keys = keysByBlock(area.blocks).flatMap((block) => block.keys)

    if (keys.length === 0) {
      continue
    }

    const bucket = areaKeysByLocale.get(area.locale) ?? new Set<string>()
    keys.forEach((key) => bucket.add(key))
    areaKeysByLocale.set(area.locale, bucket)
  }

  const pages: PageDisclaimers[] = args.pages
    .map((page) => ({
      path: page.path,
      locale: page.locale,
      page: [...(areaKeysByLocale.get(page.locale) ?? [])].sort(),
      blocks: keysByBlock(page.blocks),
    }))
    .sort((left, right) =>
      left.locale === right.locale
        ? left.path.localeCompare(right.path)
        : left.locale.localeCompare(right.locale),
    )

  let examinedRequirements = 0

  /**
   * Инвариант, который делает контракт исполнимым (Р-028): ключ,
   * перечисленный у страницы, **гарантированно присутствует** в карте
   * текстов. Для витрины отсутствие ключа в карте — нарушение контракта, а
   * не «текста нет»: рисовать пустое место нельзя.
   *
   * Обеспечивается здесь и только здесь: релиз с ключом без текста не
   * собирается.
   */
  for (const entry of pages) {
    for (const key of keysOf(entry)) {
      examinedRequirements += 1

      if (texts[entry.locale]?.[key] === undefined) {
        findings.push({
          code: 'disclaimer-text-missing',
          message: `Странице «${entry.path}» нужен дисклеймер «${key}» по составу её блоков, а текста для локали «${entry.locale}» нет. Отдать ключ без текста значило бы переложить регуляторный текст на витрину.`,
          location: `${entry.path} (${entry.locale}) → ${key}`,
        })
      }
    }
  }

  return { texts, pages, findings, examinedRequirements }
}

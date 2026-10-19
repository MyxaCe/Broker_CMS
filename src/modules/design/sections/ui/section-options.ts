import { resolveSections } from '../resolve'

import type { SectionRecord } from '../resolve'

/**
 * Выбор переиспользуемой секции по ключу ([[DEBT-011]], шестой пункт).
 *
 * Пять пунктов конструктора закрыты в ADR-0034, этот остался: ключ секции
 * вводился строкой. Разница та же, что между ссылкой на страницу и адресом,
 * вписанным руками, — введённый ключ не знает, существует ли такая секция, на
 * каком она языке и чья она. Выясняется это при сборке релиза, и выглядит как
 * `unknown-section` через неделю после правки страницы.
 *
 * Логика живёт отдельно от React по той же причине, что `media-pick` и
 * `page-options`: ошибаются именно здесь, а компонент поверх остаётся тонким.
 *
 * **Главное решение модуля:** список вариантов строится тем же
 * `resolveSections`, которым пользуется сборка релиза. Свой обход цепочки
 * разошёлся бы с движком — и разошёлся бы молча, в наследовании, где это
 * заметить труднее всего.
 */

/** Карточка секции в том виде, в каком её отдаёт локальное API Payload. */
export interface SectionRow extends SectionRecord {
  readonly id: string
  readonly title: string
}

/** Минимум, который нужен от карточки тенанта: цепочку строим по нему. */
export interface TenantLink {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
}

function relationId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return String(value)
}

export function sectionRowsOf(body: unknown): SectionRow[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  if (!Array.isArray(docs)) {
    return []
  }

  return docs.flatMap((doc) => {
    if (doc === null || typeof doc !== 'object') {
      return []
    }

    const record = doc as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key : ''
    const ownerId = relationId(record.owner)

    if (key === '' || ownerId === null) {
      return []
    }

    return [
      {
        id: String(record.id),
        key,
        title: typeof record.title === 'string' ? record.title : key,
        ownerId,
        locale: typeof record.locale === 'string' ? record.locale : '',
        /**
         * Отсутствие поля — это «не прочитали», а не «отключена». Прочитать
         * его как `false` означало бы объявить секцию снятой с публикации и
         * предложить редактору чинить то, что не сломано.
         */
        isActive: record.isActive !== false,
        blocks: record.blocks,
      },
    ]
  })
}

export const SECTION_LIST_LIMIT = 200

/**
 * Запрос к секциям.
 *
 * Фильтра по владельцу здесь нет: нужны секции **всей цепочки**, а не только
 * свои, и какие из них доступны редактору, решает изоляция тенантов на
 * сервере. Фильтр по локали есть: секция другого языка не подставится, и
 * предлагать её значит обещать то, что сборка отвергнет.
 */
export function sectionsUrl(locale: string): string {
  const base = `/api/sections?limit=${SECTION_LIST_LIMIT}&depth=0&sort=key`

  return locale === '' ? base : `${base}&where[locale][equals]=${encodeURIComponent(locale)}`
}

/**
 * Цепочка от корня к листу: `[brandId, regionId, siteId]`.
 *
 * Та же форма, которую ждут `resolveSections` и сборка релиза. Обрыв по
 * числу шагов нужен не от злого умысла, а от цикла в данных: карточка,
 * ставшая своим предком, подвесила бы редактор наглухо.
 */
export function chainTo(rows: readonly TenantLink[], leafId: string): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const chain: string[] = []
  const seen = new Set<string>()

  let current: string | null = leafId

  while (current !== null && !seen.has(current)) {
    seen.add(current)
    chain.unshift(current)
    current = byId.get(current)?.parentId ?? null
  }

  return chain
}

export interface SectionOption {
  readonly key: string
  readonly title: string
  readonly ownerId: string
  readonly ownerName: string
  readonly provenance: 'own' | 'inherited'
}

/**
 * Ключ, который в этой цепочке **не подставится**, хотя секция с таким ключом
 * существует.
 *
 * Ближайшая к листу карточка побеждает в отборе, даже будучи отключённой, и в
 * результат не попадает (`pickNearest`): отключённая секция сайта оставляет
 * пустое место, а не откатывает к секции бренда. Решение верное, но со
 * стороны редактора оно выглядит как пропавшая секция — поэтому называется
 * вслух здесь, а не только в отчёте сборки.
 */
export interface ShadowedSection {
  readonly key: string
  readonly ownerName: string
  readonly note: string
}

export interface SectionChoices {
  readonly options: readonly SectionOption[]
  readonly shadowed: readonly ShadowedSection[]
}

/**
 * Что можно выбрать в этой цепочке и на этом языке.
 *
 * Победители считаются движком (`resolveSections`), а не обходом цепочки
 * заново. Здесь остаётся только перевести их в подписи для человека.
 */
export function sectionChoices(args: {
  readonly rows: readonly SectionRow[]
  readonly tenants: readonly TenantLink[]
  readonly chainIds: readonly string[]
  readonly locale: string
}): SectionChoices {
  const nameOf = (id: string) => args.tenants.find((row) => row.id === id)?.name ?? `#${id}`
  const resolved = resolveSections({
    chainIds: args.chainIds,
    records: args.rows,
    locale: args.locale,
  })

  const options = [...resolved.entries()]
    .map(([key, section]) => ({
      key,
      title: section.title,
      ownerId: section.ownerId,
      ownerName: nameOf(section.ownerId),
      provenance: section.provenance,
    }))
    .sort((left, right) => left.key.localeCompare(right.key))

  const inChain = new Set(args.chainIds)
  const shadowed = [
    ...new Set(
      args.rows
        .filter(
          (row) => row.locale === args.locale && inChain.has(row.ownerId) && !resolved.has(row.key),
        )
        .map((row) => row.key),
    ),
  ]
    .sort()
    .map((key) => {
      const blocking = nearestOwnerOf(args, key)

      return {
        key,
        ownerName: nameOf(blocking),
        note: `Секция «${key}» есть у «${nameOf(blocking)}», но снята с публикации. Отключённая секция ближнего владельца **перекрывает** одноимённую секцию бренда и не откатывается к ней: ссылка осталась бы пустой, и сборка на ней остановится.`,
      }
    })

  return { options, shadowed }
}

function nearestOwnerOf(
  args: {
    readonly rows: readonly SectionRow[]
    readonly chainIds: readonly string[]
    readonly locale: string
  },
  key: string,
): string {
  let best = ''
  let bestRank = -1

  for (const row of args.rows) {
    if (row.key !== key || row.locale !== args.locale) {
      continue
    }

    const rank = args.chainIds.indexOf(row.ownerId)

    if (rank > bestRank) {
      bestRank = rank
      best = row.ownerId
    }
  }

  return best
}

/**
 * Что сейчас стоит в поле.
 *
 * Пять состояний, и четвёртое — то, ради чего модуль написан. Ключ, которого
 * нет среди вариантов, **не** то же самое, что пустое поле: пустое чинят
 * выбором секции, а ключ в никуда — поиском того, что удалили, отключили или
 * завели на другом языке.
 *
 * `options === null` означает «ещё не читали». Непрочитанное нельзя выдавать
 * за отсутствующее: редактор меню уже сообщал «страница удалена» о каждом
 * пункте до загрузки списка и стёр бы живые ссылки.
 */
export type SectionChoice =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'unresolved'; readonly key: string; readonly note: string }
  | { readonly kind: 'shadowed'; readonly key: string; readonly note: string }
  | { readonly kind: 'resolved'; readonly option: SectionOption; readonly note: string | null }

export function describeSectionChoice(
  value: unknown,
  choices: SectionChoices | null,
): SectionChoice {
  if (typeof value !== 'string' || value.trim() === '') {
    return { kind: 'empty' }
  }

  const key = value.trim()

  if (choices === null) {
    return { kind: 'loading', key }
  }

  const found = choices.options.find((option) => option.key === key)

  if (found !== undefined) {
    return {
      kind: 'resolved',
      option: found,
      note:
        found.provenance === 'inherited'
          ? `Секция приходит от «${found.ownerName}». Своя секция сайта с этим же ключом перекроет её.`
          : null,
    }
  }

  const blocked = choices.shadowed.find((entry) => entry.key === key)

  if (blocked !== undefined) {
    return { kind: 'shadowed', key, note: blocked.note }
  }

  return {
    kind: 'unresolved',
    key,
    note: `Секции «${key}» в этой цепочке и на этом языке нет: удалена, отключена или заведена на другом языке. Сборка релиза остановится на этой ссылке.`,
  }
}

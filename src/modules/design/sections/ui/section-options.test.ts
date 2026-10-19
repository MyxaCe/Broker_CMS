import { describe, expect, it } from 'vitest'

import {
  chainTo,
  describeSectionChoice,
  sectionChoices,
  sectionRowsOf,
  sectionsUrl,
} from './section-options'

import type { SectionRow, TenantLink } from './section-options'

/**
 * Выбор переиспользуемой секции по ключу ([[DEBT-011]], шестой пункт).
 *
 * Проверяются четыре вещи: цепочка строится по карточкам тенантов, варианты
 * совпадают с тем, что подставит сборка, перекрытая отключённая секция
 * названа отдельным состоянием, и «ещё не читали» отличимо от «такого ключа
 * нет».
 */

const TENANTS: TenantLink[] = [
  { id: 'brand', name: 'Apex', parentId: null },
  { id: 'region', name: 'Apex EU', parentId: 'brand' },
  { id: 'site', name: 'Apex Germany', parentId: 'region' },
  { id: 'other', name: 'Чужой бренд', parentId: null },
]

function row(over: Partial<SectionRow> & { key: string; ownerId: string }): SectionRow {
  return {
    id: `${over.ownerId}-${over.key}`,
    title: over.key,
    locale: 'de',
    isActive: true,
    blocks: [],
    ...over,
  }
}

const CHAIN = ['brand', 'region', 'site']

describe('цепочка владельцев', () => {
  it('строится от корня к листу', () => {
    expect(chainTo(TENANTS, 'site')).toEqual(['brand', 'region', 'site'])
  })

  it('у бренда цепочка из одного звена', () => {
    expect(chainTo(TENANTS, 'brand')).toEqual(['brand'])
  })

  /**
   * Карточка, ставшая своим предком, подвесила бы редактор наглухо. Обрыв не
   * от злого умысла, а от того, что данные бывают битыми.
   *
   * МУТАЦИЯ, КОТОРУЮ НЕЛЬЗЯ ПРОГНАТЬ, И ПОЭТОМУ ОНА ЗАПИСАНА ЗДЕСЬ. Снятие
   * защиты от цикла (`seen`) не красит этот тест — оно его **вешает**:
   * цикл синхронный, и таймаут прогона его не прерывает. Зависание списывают
   * на «что-то долго», а красный тест чинят, поэтому мутация в прогон не
   * входит сознательно, а не по забывчивости.
   */
  it('цикл в данных обрывается, а не вешает обход', () => {
    const looped: TenantLink[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]

    expect(chainTo(looped, 'a')).toEqual(['b', 'a'])
  })
})

describe('чтение карточек секций', () => {
  it('ключ и владелец обязательны: без них вариант предлагать нечего', () => {
    const rows = sectionRowsOf({
      docs: [
        { id: 1, key: 'risks', title: 'Риски', owner: 'brand', locale: 'de', isActive: true },
        { id: 2, key: '', owner: 'brand' },
        { id: 3, key: 'orphan' },
        null,
      ],
    })

    expect(rows.map((item) => item.key)).toEqual(['risks'])
  })

  it('владелец читается и объектом, и идентификатором', () => {
    const rows = sectionRowsOf({
      docs: [
        { id: 1, key: 'a', owner: { id: 'brand' } },
        { id: 2, key: 'b', owner: 7 },
      ],
    })

    expect(rows.map((item) => item.ownerId)).toEqual(['brand', '7'])
  })

  /**
   * Отсутствие поля — «не прочитали», а не «отключена». Прочитать его как
   * `false` значило бы объявить секцию снятой и отправить редактора чинить
   * то, что не сломано.
   */
  it('отсутствующий признак действия читается как действующая', () => {
    expect(sectionRowsOf({ docs: [{ id: 1, key: 'a', owner: 'brand' }] })[0]?.isActive).toBe(true)
  })

  it('не объект вместо ответа — пустой список, а не исключение', () => {
    expect(sectionRowsOf(null)).toEqual([])
    expect(sectionRowsOf({ docs: 'строка' })).toEqual([])
  })
})

describe('запрос к секциям', () => {
  /** Секция другого языка не подставится: предлагать её — обещать отказ сборки. */
  it('сужается по локали', () => {
    expect(sectionsUrl('de')).toContain('where[locale][equals]=de')
  })

  /**
   * Фильтра по владельцу нет намеренно: нужны секции **всей цепочки**, а что
   * из них доступно — решает изоляция тенантов на сервере.
   */
  it('по владельцу не сужается', () => {
    expect(sectionsUrl('de')).not.toContain('owner')
  })
})

describe('варианты для выбора', () => {
  const rows = [
    row({ key: 'risks', ownerId: 'brand', title: 'Риски (бренд)' }),
    row({ key: 'how-to-open', ownerId: 'brand', title: 'Как открыть счёт' }),
    row({ key: 'risks', ownerId: 'site', title: 'Риски (сайт)' }),
    row({ key: 'foreign', ownerId: 'other', title: 'Чужая' }),
    row({ key: 'other-locale', ownerId: 'brand', locale: 'en', title: 'Другой язык' }),
  ]

  const choices = sectionChoices({ rows, tenants: TENANTS, chainIds: CHAIN, locale: 'de' })

  it('ближайший владелец побеждает, и это видно в подписи', () => {
    const risks = choices.options.find((option) => option.key === 'risks')

    expect(risks?.title).toBe('Риски (сайт)')
    expect(risks?.provenance).toBe('own')
  })

  it('секция бренда предлагается с пометкой, откуда она', () => {
    const inherited = choices.options.find((option) => option.key === 'how-to-open')

    expect(inherited?.provenance).toBe('inherited')
    expect(inherited?.ownerName).toBe('Apex')
  })

  it('секция чужой цепочки не предлагается', () => {
    expect(choices.options.map((option) => option.key)).not.toContain('foreign')
  })

  it('секция другого языка не предлагается', () => {
    expect(choices.options.map((option) => option.key)).not.toContain('other-locale')
  })

  it('порядок вариантов не зависит от порядка карточек', () => {
    const shuffled = sectionChoices({
      rows: [...rows].reverse(),
      tenants: TENANTS,
      chainIds: CHAIN,
      locale: 'de',
    })

    expect(shuffled.options.map((option) => option.key)).toEqual(
      choices.options.map((option) => option.key),
    )
  })
})

/**
 * РАСТЯЖКА на правило `pickNearest`: отключённая секция ближнего владельца
 * **побеждает** в отборе и в результат не попадает — ссылка остаётся пустой,
 * а не откатывается к секции бренда. Правило верное (тихий откат к чужому
 * тексту хуже пустоты), но со стороны редактора выглядит как пропавшая
 * секция. Если кто-нибудь «починит» откат, этот тест покраснеет.
 */
describe('перекрытая и отключённая секция', () => {
  const rows = [
    row({ key: 'risks', ownerId: 'brand', title: 'Риски (бренд)' }),
    row({ key: 'risks', ownerId: 'site', title: 'Риски (сайт)', isActive: false }),
  ]

  const choices = sectionChoices({ rows, tenants: TENANTS, chainIds: CHAIN, locale: 'de' })

  it('в вариантах её нет, хотя секция бренда с таким ключом есть', () => {
    expect(choices.options).toEqual([])
  })

  it('ключ назван отдельно, с объяснением и владельцем', () => {
    expect(choices.shadowed).toHaveLength(1)
    expect(choices.shadowed[0]?.key).toBe('risks')
    expect(choices.shadowed[0]?.ownerName).toBe('Apex Germany')
  })
})

describe('что стоит в поле', () => {
  const choices = sectionChoices({
    rows: [
      row({ key: 'risks', ownerId: 'brand', title: 'Риски' }),
      row({ key: 'hidden', ownerId: 'site', isActive: false }),
    ],
    tenants: TENANTS,
    chainIds: CHAIN,
    locale: 'de',
  })

  it('пустое поле', () => {
    expect(describeSectionChoice('', choices).kind).toBe('empty')
    expect(describeSectionChoice('   ', choices).kind).toBe('empty')
    expect(describeSectionChoice(undefined, choices).kind).toBe('empty')
  })

  /**
   * Непрочитанное нельзя выдавать за отсутствующее: редактор меню уже
   * сообщал «страница удалена» о каждом пункте до загрузки списка.
   */
  it('список ещё не прочитан — это не «ключа нет»', () => {
    expect(describeSectionChoice('risks', null)).toEqual({ kind: 'loading', key: 'risks' })
  })

  it('известный ключ разрешается, у унаследованного — пометка откуда', () => {
    const choice = describeSectionChoice('risks', choices)

    expect(choice.kind).toBe('resolved')
    expect(choice.kind === 'resolved' ? choice.note : null).toContain('Apex')
  })

  it('неизвестный ключ назван ошибкой и объяснён', () => {
    const choice = describeSectionChoice('нет-такой', choices)

    expect(choice.kind).toBe('unresolved')
    expect(choice.kind === 'unresolved' ? choice.note : '').toContain('Сборка релиза остановится')
  })

  /**
   * Три состояния у одного «не подставится»: ключа нет вовсе, ключ перекрыт
   * отключённой секцией, список ещё не прочитан. Чинятся они по-разному, и
   * схлопывать их в одно сообщение значит отправить редактора не туда.
   */
  it('перекрытый ключ отличим от неизвестного', () => {
    expect(describeSectionChoice('hidden', choices).kind).toBe('shadowed')
    expect(describeSectionChoice('нет-такой', choices).kind).toBe('unresolved')
  })
})

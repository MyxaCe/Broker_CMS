import { describe, expect, it } from 'vitest'

import { toArticleFeedItem } from './article-item'
import { afterCursorWhere, decodeCursor, encodeCursor } from './cursor'
import { mapFeed, MappingError, requireText, requireValue } from './mapper'
import { buildFeedQuery, buildPinnedQuery, FeedQueryError, MAX_PAGE_SIZE } from './query'

describe('курсор', () => {
  it('кодирование и разбор возвращают исходную позицию', () => {
    const position = { sortValue: '2026-08-05T10:00:00.000Z', id: '42' }

    expect(decodeCursor(encodeCursor(position))).toEqual(position)
  })

  /**
   * Читаемый курсор — приглашение его подделать и обещание не менять форму.
   */
  it('курсор непрозрачен', () => {
    const encoded = encodeCursor({ sortValue: '2026-08-05T10:00:00.000Z', id: '42' })

    expect(encoded).not.toContain('2026')
    expect(encoded).not.toContain('42')
  })

  it.each([
    ['пустая строка', ''],
    ['мусор', 'не-курсор!!!'],
    ['без разделителя', Buffer.from('только-дата').toString('base64url')],
    ['пустой идентификатор', Buffer.from('2026-08-05T10:00:00.000Z|').toString('base64url')],
    ['неразобранная дата', Buffer.from('вчера|42').toString('base64url')],
    ['null', null],
    ['undefined', undefined],
  ])('порча курсора даёт null, а не исключение: %s', (_name, value) => {
    expect(decodeCursor(value as string | null | undefined)).toBeNull()
  })

  /**
   * Даты публикации совпадают чаще, чем кажется: редактор выпускает подборку
   * одним нажатием, и у всех записей одна отметка времени. По одному полю
   * порядок неустойчив, и запись либо повторяется, либо теряется.
   */
  it('условие «после позиции» учитывает и дату, и идентификатор', () => {
    const where = afterCursorWhere(
      { sortValue: '2026-08-05T10:00:00.000Z', id: '42' },
      { sortField: 'publishAt' },
    )

    const dump = JSON.stringify(where)

    expect(dump).toContain('less_than')
    expect(dump).toContain('"id"')
    expect(dump).toContain('equals')
  })
})

describe('тотальный маппер', () => {
  /** Одна испорченная запись не должна гасить витрину. */
  it('битая запись исключается, остальные проходят', () => {
    const result = mapFeed(
      [
        { id: 1, ok: true },
        { id: 2, ok: false },
        { id: 3, ok: true },
      ],
      (record) => {
        if (record.ok !== true) {
          throw new MappingError('нет обязательного поля')
        }

        return record.id
      },
    )

    expect(result.items).toEqual([1, 3])
    expect(result.excluded).toEqual([{ id: '2', reason: 'нет обязательного поля' }])
  })

  /**
   * Ловится всё, включая то, чего маппер не обещал: непойманное исключение
   * означало бы отказ всей ленты из-за одной записи.
   */
  it('маппер не бросает даже на неожиданной ошибке', () => {
    expect(() =>
      mapFeed([{ id: 1 }], () => {
        throw new TypeError('совсем другое')
      }),
    ).not.toThrow()
  })

  it('пустой вход даёт пустой выход', () => {
    expect(mapFeed([], () => 1)).toEqual({ items: [], excluded: [] })
  })

  it('requireValue и requireText отвергают пустые значения', () => {
    expect(() => requireValue(null, 'поле')).toThrow(MappingError)
    expect(() => requireValue('', 'поле')).toThrow(MappingError)
    expect(() => requireText('   ', 'поле')).toThrow(MappingError)
    expect(requireText('значение', 'поле')).toBe('значение')
  })
})

describe('элемент ленты', () => {
  const doc = {
    id: 1,
    slug: 'stavka-povyshena',
    title: 'Ставка повышена',
    excerpt: 'Коротко о решении',
    publishAt: '2026-08-05T10:00:00.000Z',
    readingMinutes: 4,
    category: { slug: 'analytics', title: 'Аналитика' },
    tags: [{ slug: 'rates', title: 'Ставки' }],
    authors: [{ slug: 'ivanov', title: 'Иванов' }],
    cover: { url: 'https://media.example.test/a.png', alt: 'График ставки' },
    relatedInstruments: [{ symbol: 'EURUSD' }],
    featured: true,
    pinned: false,
  }

  it('собирается из полной записи', () => {
    expect(toArticleFeedItem(doc)).toMatchObject({
      slug: 'stavka-povyshena',
      title: 'Ставка повышена',
      category: { slug: 'analytics', title: 'Аналитика' },
      tags: ['rates'],
      instruments: ['EURUSD'],
      featured: true,
    })
  })

  it.each(['slug', 'title', 'publishAt'])('без поля %s запись непригодна', (field) => {
    expect(() => toArticleFeedItem({ ...doc, [field]: undefined })).toThrow(MappingError)
  })

  it('необязательные поля могут отсутствовать', () => {
    const item = toArticleFeedItem({
      id: 2,
      slug: 'a',
      title: 'Б',
      publishAt: '2026-08-05T10:00:00.000Z',
    })

    expect(item.excerpt).toBeNull()
    expect(item.category).toBeNull()
    expect(item.tags).toEqual([])
    expect(item.cover).toBeNull()
    expect(item.readingMinutes).toBe(0)
  })

  /**
   * Картинка без alt — нарушение доступности на витрине. Лучше её отсутствие,
   * чем она же, но недоступная.
   */
  it('обложка без альтернативного текста не отдаётся', () => {
    const item = toArticleFeedItem({ ...doc, cover: { url: 'https://a/b.png' } })

    expect(item.cover).toBeNull()
  })

  /**
   * Неразвёрнутая связь — следствие глубины выборки, а не порча записи.
   * Терять материал из-за настройки запроса нельзя.
   */
  it('неразвёрнутая связь не выбрасывает запись из ленты', () => {
    const item = toArticleFeedItem({ ...doc, category: 7, tags: [7, 8] })

    expect(item.category).toBeNull()
    expect(item.tags).toEqual([])
    expect(item.slug).toBe('stavka-povyshena')
  })
})

describe('запрос ленты', () => {
  const base = { siteId: 10 }

  it('всегда ограничен сайтом', () => {
    expect(JSON.stringify(buildFeedQuery(base).where)).toContain('"site"')
  })

  /**
   * Условие видимости в запрос НЕ добавляется: оно приходит из правила доступа.
   * Второе место, где решается, что видно снаружи, — это первое расхождение и
   * первая утечка.
   */
  it('условие видимости в запросе не строится', () => {
    const dump = JSON.stringify(buildFeedQuery(base).where)

    expect(dump).not.toContain('status')
    expect(dump).not.toContain('unpublishAt')
  })

  it.each([
    ['category', 'analytics', 'category.slug'],
    ['tag', 'rates', 'tags.slug'],
    ['author', 'ivanov', 'authors.slug'],
    ['instrument', 'EURUSD', 'relatedInstruments.symbol'],
  ])('фильтр %s', (key, value, expected) => {
    const query = buildFeedQuery({ ...base, [key]: value })

    expect(JSON.stringify(query.where)).toContain(expected)
  })

  /**
   * Пустой список юрисдикций означает «во всех». Фильтр, не пропускающий его,
   * прячет большую часть ленты — и выглядит это как потеря данных.
   */
  it('фильтр юрисдикции пропускает материалы без указанной юрисдикции', () => {
    const dump = JSON.stringify(buildFeedQuery({ ...base, jurisdiction: 'eu-mifid' }).where)

    expect(dump).toContain('eu-mifid')
    expect(dump).toContain('exists')
  })

  it('неразобранная дата отвергается', () => {
    expect(() => buildFeedQuery({ ...base, since: 'позавчера' })).toThrow(FeedQueryError)
    expect(() => buildFeedQuery({ ...base, until: 'потом' })).toThrow(FeedQueryError)
  })

  it('читается на одну запись больше запрошенного', () => {
    const query = buildFeedQuery({ ...base, limit: 20 })

    expect(query.pageSize).toBe(20)
    expect(query.limit).toBe(21)
  })

  /**
   * Обрезка, а не отказ: попросивший тысячу хочет много и быстро, и отказ он
   * воспримет как поломку.
   */
  it('чрезмерный размер страницы обрезается', () => {
    expect(buildFeedQuery({ ...base, limit: 5000 }).pageSize).toBe(MAX_PAGE_SIZE)
  })

  it.each([0, -1, 1.5])('некорректный размер страницы отвергается: %s', (limit) => {
    expect(() => buildFeedQuery({ ...base, limit })).toThrow(FeedQueryError)
  })

  /**
   * Массивом, а не строкой с запятой: строку Payload принимает молча и
   * сортирует только по первому полю — порядок при совпадающих датах остаётся
   * произвольным, и курсорная пагинация ломается.
   */
  it('сортировка составная, массивом, и совпадает с формой курсора', () => {
    expect(buildFeedQuery(base).sort).toEqual(['-publishAt', '-id'])
    expect(buildPinnedQuery(10).sort).toEqual(['-publishAt', '-id'])
  })

  it('курсор превращается в условие «после позиции»', () => {
    const cursor = encodeCursor({ sortValue: '2026-08-05T10:00:00.000Z', id: '42' })
    const query = buildFeedQuery({ ...base, cursor })

    expect(query.position).not.toBeNull()
    expect(JSON.stringify(query.where)).toContain('less_than')
  })

  /** Испорченный курсор начинает ленту сначала, а не роняет запрос. */
  it('испорченный курсор не роняет запрос', () => {
    const query = buildFeedQuery({ ...base, cursor: 'мусор' })

    expect(query.position).toBeNull()
  })
})

describe('закреплённое', () => {
  /**
   * Отдельным запросом, а не сортировкой: закреплённое обязано висеть вверху
   * каждой страницы, а сортировка действует внутри выборки.
   */
  it('запрос закреплённого ограничен сайтом и признаком', () => {
    const dump = JSON.stringify(buildPinnedQuery(10).where)

    expect(dump).toContain('"site"')
    expect(dump).toContain('"pinned"')
  })
})

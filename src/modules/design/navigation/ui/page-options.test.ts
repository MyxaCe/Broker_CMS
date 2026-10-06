import { describe, expect, it } from 'vitest'

import {
  describeOption,
  describePageChoice,
  pageOptions,
  siteIdsUnder,
  tenantRows,
  warnAboutForeignPages,
} from './page-options'

const TENANTS = {
  docs: [
    { id: 'brand', name: 'Apex', kind: 'brand', parent: null },
    { id: 'eu', name: 'Европа', kind: 'region', parent: 'brand' },
    { id: 'de', name: 'Германия', kind: 'site', parent: 'eu' },
    { id: 'fr', name: 'Франция', kind: 'site', parent: { id: 'eu' } },
    { id: 'other', name: 'Чужой', kind: 'brand', parent: null },
    { id: 'alien', name: 'Чужой сайт', kind: 'site', parent: 'other' },
    { id: 'junk', name: 'Не тенант', kind: 'выдумка', parent: null },
  ],
}

describe('сайты, на которых действует меню', () => {
  it('меню бренда действует на всех его сайтах, включая вложенные в регион', () => {
    expect(siteIdsUnder(tenantRows(TENANTS), 'brand').sort()).toEqual(['de', 'fr'])
  })

  it('меню сайта — только его собственный', () => {
    expect(siteIdsUnder(tenantRows(TENANTS), 'de')).toEqual(['de'])
  })

  it('чужое поддерево не попадает', () => {
    expect(siteIdsUnder(tenantRows(TENANTS), 'brand')).not.toContain('alien')
  })

  it('владелец, раскрытый объектом, читается так же, как идентификатором', () => {
    expect(siteIdsUnder(tenantRows(TENANTS), 'eu').sort()).toEqual(['de', 'fr'])
  })

  it('запись неизвестного вида отбрасывается, а не считается сайтом', () => {
    expect(tenantRows(TENANTS).map((row) => row.id)).not.toContain('junk')
  })

  it('неизвестный владелец даёт пустой список, а не все сайты', () => {
    /** Обратное умолчание открыло бы редактору чужие страницы. */
    expect(siteIdsUnder(tenantRows(TENANTS), 'нет-такого')).toEqual([])
  })

  it('цикл в дереве не зацикливает обход', () => {
    const rows = tenantRows({
      docs: [
        { id: 'a', name: 'A', kind: 'brand', parent: 'b' },
        { id: 'b', name: 'B', kind: 'site', parent: 'a' },
      ],
    })

    expect(siteIdsUnder(rows, 'a')).toEqual(['b'])
  })
})

describe('предупреждение о чужих страницах', () => {
  it('меню одного сайта предупреждения не требует', () => {
    expect(warnAboutForeignPages(['de'])).toBeNull()
  })

  it('меню нескольких сайтов предупреждает, что пункт исчезнет на остальных', () => {
    const warning = warnAboutForeignPages(['de', 'fr'])

    expect(warning).toContain('не появится')
  })
})

describe('список страниц', () => {
  const PAGES = {
    docs: [
      { id: '2', path: '/about', title: 'О нас', site: 'de', status: 'published' },
      { id: '1', path: '/', title: 'Главная', site: { id: 'de' }, status: 'published' },
      { id: '3', path: '/draft', title: 'Черновик', site: 'de', status: 'draft' },
    ],
  }

  it('сортируется по пути: по нему страницу и узнают', () => {
    expect(pageOptions(PAGES).map((option) => option.path)).toEqual(['/', '/about', '/draft'])
  })

  it('ответ без docs даёт пустой список, а не падение', () => {
    expect(pageOptions(null)).toEqual([])
    expect(pageOptions({ error: 'unauthorized' })).toEqual([])
  })

  it('подпись начинается с пути', () => {
    expect(describeOption(pageOptions(PAGES)[1]!)).toBe('/about — О нас')
  })

  it('страница без заголовка подписывается путём, а не пустым местом', () => {
    expect(
      describeOption({ id: '9', path: '/x', title: '', siteId: 'de', status: 'published' }),
    ).toBe('/x')
  })

  describe('выбор страницы', () => {
    const options = pageOptions(PAGES)

    it('пусто — страница не выбрана', () => {
      expect(describePageChoice(null, options).kind).toBe('empty')
      expect(describePageChoice('  ', options).kind).toBe('empty')
    })

    it('непрочитанный список не выдаётся за удалённую страницу', () => {
      /**
       * Поймано собственным тестом разметки: пока список пуст, каждый пункт
       * сообщал «страница удалена». Редактор чинил бы то, что не сломано, —
       * и первым делом стёр бы живую ссылку.
       */
      const choice = describePageChoice('1', null)

      expect(choice.kind).toBe('unknown')
    })

    it('прочитанный пустой список — это уже «страницы нет»', () => {
      expect(describePageChoice('1', []).kind).toBe('unresolved')
    })

    it('страницы нет среди доступных — это расхождение, а не пустой выбор', () => {
      const choice = describePageChoice('999', options)

      expect(choice.kind).toBe('unresolved')
      expect(choice.kind === 'unresolved' ? choice.note : '').toContain('расхождением')
    })

    it('опубликованная страница выбрана без оговорок', () => {
      const choice = describePageChoice('1', options)

      expect(choice.kind).toBe('resolved')
      expect(choice.kind === 'resolved' ? choice.note : 'не null').toBeNull()
    })

    it('черновик выбран, но с оговоркой: в меню он не появится', () => {
      const choice = describePageChoice('3', options)

      expect(choice.kind).toBe('resolved')
      expect(choice.kind === 'resolved' ? choice.note : '').toContain('черновике')
    })

    it('числовой идентификатор читается так же, как строковый', () => {
      expect(describePageChoice(1, options).kind).toBe('resolved')
    })
  })
})

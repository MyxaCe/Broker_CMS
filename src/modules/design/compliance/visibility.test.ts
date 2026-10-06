import { describe, expect, it } from 'vitest'

import { blockVisibilityIn, filterByJurisdiction, visibilityIn } from './visibility'

/**
 * Правило видимости по юрисдикции.
 *
 * До этого его не было нигде: выдача отдаёт ограничения, а решает каждый
 * потребитель сам. Три умолчания названы здесь явно, и все три несимметричны.
 */

describe('пустое ограничение означает «во всех»', () => {
  it('нет поля — видно', () => {
    expect(visibilityIn(undefined, 'eu-mifid').visible).toBe(true)
  })

  it('пустой список — видно', () => {
    expect(visibilityIn([], 'eu-mifid').visible).toBe(true)
  })

  it('не список — видно: мусор не прячет содержимое молча', () => {
    expect(visibilityIn('eu-mifid', 'eu-mifid').visible).toBe(true)
  })

  it('пустое ограничение видно и без юрисдикции', () => {
    expect(visibilityIn([], null).visible).toBe(true)
  })
})

describe('ограничение действует', () => {
  it('своя юрисдикция — видно', () => {
    expect(visibilityIn(['eu-mifid', 'uk-fca'], 'eu-mifid').visible).toBe(true)
  })

  it('чужая — не видно, и причина названа', () => {
    const verdict = visibilityIn(['uk-fca'], 'eu-mifid')

    expect(verdict.visible).toBe(false)
    expect(verdict.reason).toContain('uk-fca')
    expect(verdict.reason).toContain('eu-mifid')
  })

  it('ограничение есть, юрисдикция неизвестна — не видно', () => {
    /**
     * Несимметричное умолчание, и направление выбрано сознательно: «я не
     * знаю, где вы» не является доказательством, что показывать можно.
     */
    const verdict = visibilityIn(['uk-fca'], null)

    expect(verdict.visible).toBe(false)
    expect(verdict.reason).toContain('неизвестность не разрешение')
  })

  it('пустая строка юрисдикции — то же, что отсутствие', () => {
    expect(visibilityIn(['uk-fca'], '').visible).toBe(false)
  })

  it('ограничения, записанные объектами {code}, читаются наравне со строками', () => {
    /** Повторяемая группа Payload хранится именно так. */
    expect(visibilityIn([{ code: 'eu-mifid' }], 'eu-mifid').visible).toBe(true)
    expect(visibilityIn([{ code: 'uk-fca' }], 'eu-mifid').visible).toBe(false)
  })

  it('пустые записи в списке не считаются ограничением', () => {
    expect(visibilityIn(['', { code: '' }], 'eu-mifid').visible).toBe(true)
  })
})

describe('ограничение блока лежит в visibility', () => {
  it('читается оттуда, а не из корня узла', () => {
    expect(
      blockVisibilityIn({ type: 'hero', visibility: { jurisdictions: ['uk-fca'] } }, 'eu-mifid')
        .visible,
    ).toBe(false)
  })

  it('ограничение, положенное в корень узла, блок не прячет', () => {
    /**
     * Проверка от «догадливости»: модель хранит ограничение в `visibility`,
     * и чтение из корня означало бы вторую, несуществующую форму записи.
     */
    expect(blockVisibilityIn({ type: 'hero', jurisdictions: ['uk-fca'] }, 'eu-mifid').visible).toBe(
      true,
    )
  })

  it('узел без visibility видим', () => {
    expect(blockVisibilityIn({ type: 'hero' }, 'eu-mifid').visible).toBe(true)
  })
})

describe('фильтрация дерева', () => {
  const tree = [
    { type: 'hero' },
    { type: 'promo', visibility: { jurisdictions: ['uk-fca'] } },
    {
      type: 'columns',
      slots: {
        columns: [
          { type: 'quote' },
          { type: 'cfd-calc', visibility: { jurisdictions: ['uk-fca'] } },
        ],
      },
    },
  ]

  it('скрывает ограниченное и считает скрытое', () => {
    const result = filterByJurisdiction(tree, 'eu-mifid')

    expect(result.blocks.map((node) => (node as { type: string }).type)).toEqual([
      'hero',
      'columns',
    ])
    expect(result.hidden).toBe(2)
  })

  it('вложенные блоки фильтруются тоже: перенос в колонку не обходит правило', () => {
    const result = filterByJurisdiction(tree, 'eu-mifid')
    const columns = result.blocks[1] as { slots: { columns: { type: string }[] } }

    expect(columns.slots.columns.map((node) => node.type)).toEqual(['quote'])
  })

  it('скрытый блок уходит вместе с потомками', () => {
    const result = filterByJurisdiction(
      [
        {
          type: 'columns',
          visibility: { jurisdictions: ['uk-fca'] },
          slots: { columns: [{ type: 'quote' }] },
        },
      ],
      'eu-mifid',
    )

    expect(result.blocks).toEqual([])
    expect(result.hidden).toBe(1)
  })

  it('в своей юрисдикции не скрывается ничего', () => {
    const result = filterByJurisdiction(tree, 'uk-fca')

    expect(result.hidden).toBe(0)
    expect(result.blocks).toHaveLength(3)
  })

  it('исходное дерево не меняется', () => {
    filterByJurisdiction(tree, 'eu-mifid')

    expect(tree).toHaveLength(3)
    expect((tree[2] as { slots: { columns: unknown[] } }).slots.columns).toHaveLength(2)
  })

  it('пустая страница и страница, с которой всё убрала юрисдикция, различимы', () => {
    expect(filterByJurisdiction([], 'eu-mifid')).toEqual({ blocks: [], hidden: 0 })
    expect(
      filterByJurisdiction(
        [{ type: 'promo', visibility: { jurisdictions: ['uk-fca'] } }],
        'eu-mifid',
      ).hidden,
    ).toBe(1)
  })

  it('мусор вместо дерева не роняет фильтр', () => {
    expect(filterByJurisdiction(null, 'eu-mifid')).toEqual({ blocks: [], hidden: 0 })
    expect(filterByJurisdiction('строка', 'eu-mifid')).toEqual({ blocks: [], hidden: 0 })
  })
})

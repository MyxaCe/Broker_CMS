import { describe, expect, it } from 'vitest'

import cases from '@/contracts/visibility-cases.v2.json'
import supersededV1 from '@/contracts/visibility-cases.v1.json'

import {
  blockVisibilityIn,
  filterByJurisdiction,
  filterNavByJurisdiction,
  readJurisdictions,
  visibilityIn,
} from './visibility'

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
    expect(verdict.reason).toBe('jurisdiction-not-listed')
    expect(verdict.explanation).toContain('uk-fca')
    expect(verdict.explanation).toContain('eu-mifid')
  })

  it('ограничение есть, юрисдикция неизвестна — не видно', () => {
    /**
     * Несимметричное умолчание, и направление выбрано сознательно: «я не
     * знаю, где вы» не является доказательством, что показывать можно.
     */
    const verdict = visibilityIn(['uk-fca'], null)

    expect(verdict.visible).toBe(false)
    expect(verdict.reason).toBe('jurisdiction-unknown')
    expect(verdict.explanation).toContain('неизвестность не разрешение')
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

/**
 * Меню (Р-045, ADR-0037).
 *
 * Правило то же, форма дерева другая: у пункта меню дети лежат прямо в
 * `children`, а не в именованных слотах. Поэтому у фильтра меню свои
 * проверки — обобщение двух форм потеряло бы одну из них незаметно.
 */
describe('фильтр меню по юрисдикции', () => {
  const menu = [
    { label: 'Счета', jurisdictions: [], children: [] },
    {
      label: 'Торговля',
      jurisdictions: [],
      children: [
        { label: 'CFD', jurisdictions: ['uk-fca'], children: [] },
        { label: 'Акции', jurisdictions: [], children: [] },
      ],
    },
    { label: 'Крипта', jurisdictions: ['uk-fca'], children: [] },
  ]

  it('в чужой юрисдикции ограниченные пункты исчезают, остальные остаются', () => {
    const result = filterNavByJurisdiction(menu, 'eu-mifid')

    expect(result.items.map((item) => item.label)).toEqual(['Счета', 'Торговля'])
    expect(result.items[1]?.children.map((child) => child.label)).toEqual(['Акции'])
  })

  it('в своей юрисдикции меню приходит целиком', () => {
    const result = filterNavByJurisdiction(menu, 'uk-fca')

    expect(result.items).toHaveLength(3)
    expect(result.hidden).toBe(0)
  })

  /**
   * Несимметричное умолчание то же, что у блоков: «я не знаю, где вы» не
   * является доказательством, что показывать можно.
   */
  it('незаданная юрисдикция скрывает ограниченное, а не показывает', () => {
    const result = filterNavByJurisdiction(menu, null)

    expect(result.items.map((item) => item.label)).toEqual(['Счета', 'Торговля'])
  })

  /**
   * Раздела, которого нет, не бывает с видимыми подпунктами: иначе витрина
   * нарисовала бы подпункты без заголовка.
   */
  it('скрытый раздел уходит вместе с подпунктами, и они считаны один раз', () => {
    const result = filterNavByJurisdiction(
      [
        {
          label: 'Только Британия',
          jurisdictions: ['uk-fca'],
          children: [{ label: 'Внутри', jurisdictions: [], children: [] }],
        },
      ],
      'eu-mifid',
    )

    expect(result.items).toEqual([])
    expect(result.hidden).toBe(1)
  })

  it('пустое меню и меню, из которого всё убрала юрисдикция, различимы', () => {
    expect(filterNavByJurisdiction([], 'eu-mifid')).toEqual({ items: [], hidden: 0 })
    expect(
      filterNavByJurisdiction([{ label: 'X', jurisdictions: ['uk-fca'], children: [] }], 'eu-mifid')
        .hidden,
    ).toBe(1)
  })

  it('мусор вместо меню не роняет фильтр', () => {
    expect(filterNavByJurisdiction(null as never, 'eu-mifid')).toEqual({ items: [], hidden: 0 })
    expect(filterNavByJurisdiction('строка' as never, 'eu-mifid')).toEqual({
      items: [],
      hidden: 0,
    })
  })
})

/**
 * Чтение поля ограничений — одно на всех (Р-045).
 *
 * Формы две: повторяемая группа Payload у областей и плоский список строк у
 * дерева меню. Второй читатель разошёлся бы с первым молча, а ограничение,
 * прочитанное как пустое, означает «видно всем».
 */
describe('чтение поля ограничений', () => {
  it('обе формы записи читаются одинаково', () => {
    expect(readJurisdictions(['uk-fca'])).toEqual(['uk-fca'])
    expect(readJurisdictions([{ code: 'uk-fca' }])).toEqual(['uk-fca'])
  })

  it('пробелы обрезаются, пустые и мусорные значения отбрасываются', () => {
    expect(readJurisdictions([' uk-fca ', '', null, 42, { code: '  ' }])).toEqual(['uk-fca'])
  })

  it('не список — пустой список ограничений, а не исключение', () => {
    expect(readJurisdictions(undefined)).toEqual([])
    expect(readJurisdictions('uk-fca')).toEqual([])
  })
})

/**
 * Эталонные случаи правила, версия 2 (Р-061).
 *
 * Правило обязано быть одним на всех потребителей, но взять его кодом может
 * не каждый: терминал написан на Rust. Поэтому рядом с контрактом лежит
 * таблица случаев — её прогоняет своим тестом каждая реализация, и
 * расхождение становится красным тестом у того, кто разошёлся, а не жалобой
 * из регулируемой юрисдикции.
 *
 * Здесь таблицу прогоняет **источник**. Таблица, которой не удовлетворяет сам
 * источник правила, не годится в эталон никому.
 *
 * **Почему версия вторая.** Версия 1 прошла у всех трёх реализаций с первого
 * прогона, и расхождений с правилом не нашлось — дыры были в самих случаях,
 * и нашла их команда `terminal` мутационным прогоном. Случай на форму
 * `{code}` был разрешающим, а разрешающий ответ совпадает с умолчанием:
 * мутация «форму не читаем вовсе» его не красила. Два разных отказа давали
 * одинаковое булево. Случаи на дерево сверяли только верхний уровень.
 * Добавление случаев несовместимо — поэтому версия новая, а не правка под
 * тем же именем.
 */
describe('эталонные случаи видимости · v2', () => {
  it.each(cases.items.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    const verdict = visibilityIn(item.restrictions, item.jurisdiction)

    expect(verdict.visible).toBe(item.visible)

    /**
     * Сверяется **машинный код**, а не только булево. На булевом «юрисдикция
     * неизвестна» и «юрисдикции нет в списке» неотличимы, и мутация «пустая
     * строка — особая юрисдикция» не красила ничего.
     */
    expect(verdict.reason).toBe(item.reason)

    /**
     * Подпись для человека обязана быть там же, где отказ, и отсутствовать
     * там, где его нет. Её текст таблицей не закрепляется намеренно: она
     * ходит через перевод, а машинный признак — нет.
     */
    expect(typeof verdict.explanation === 'string').toBe(!item.visible)
  })

  interface CaseNode {
    readonly label: string
    readonly jurisdictions: readonly string[]
    readonly children: readonly CaseNode[]
  }

  interface ExpectedNode {
    readonly label: string
    readonly children: readonly ExpectedNode[]
  }

  /** Приводит отфильтрованное дерево к форме ожидания: метки и вложенность. */
  const shape = (items: readonly CaseNode[]): ExpectedNode[] =>
    items.map((item) => ({ label: item.label, children: shape(item.children ?? []) }))

  it.each(cases.trees.map((tree) => [tree.name, tree] as const))('дерево: %s', (_name, example) => {
    const result = filterNavByJurisdiction(
      example.tree as readonly CaseNode[],
      example.jurisdiction,
    )

    /**
     * Сверяется дерево целиком, а не метки верхнего уровня. Измерено: на
     * метках реализация, которая правильно считает скрытое и возвращает
     * потомков нефильтрованными, проходила таблицу целиком.
     */
    expect(shape(result.items)).toEqual(example.visibleTree)
    expect(result.hidden).toBe(example.hidden)
  })

  /**
   * Пустая таблица прошла бы любую реализацию. Охват объявляется числом —
   * иначе «эталон выполнен» перестанет что-либо означать, стоит кому-то
   * случайно опустошить файл.
   */
  it('таблица не пуста и охват объявлен числом', () => {
    expect(cases.items.length).toBeGreaterThanOrEqual(19)
    expect(cases.trees.length).toBeGreaterThanOrEqual(6)
  })

  /**
   * Охват объявлен не только числом, но и **составом** — и состав
   * проверяется прогоном, а не счётом.
   *
   * Урок, ради которого заведена v2: случай, который должен доказывать, что
   * реализация читает форму `{code}`, обязан давать ответ, отличный от
   * ответа того, кто эту форму игнорирует. Иначе он проходит у
   * непрочитавшего — именно это `terminal` и измерил на v1.
   *
   * Считать для этого разрешающие и ограничивающие случаи **нельзя**:
   * соотношение чисел меряется заметно проще, чем утверждение, которое оно
   * подменяет, — а значит почти наверняка его не подменяет. Поэтому здесь
   * воспроизводится сама непрочитавшая реализация: из ограничений
   * выбрасывается форма `{code}`, и ответ обязан измениться.
   */
  it('случай, закрепляющий чтение формы `{code}`, не проходит у того, кто её игнорирует', () => {
    const reading = cases.items.filter((item) => item.pins === 'reads-field')

    expect(reading.length).toBeGreaterThanOrEqual(3)

    for (const item of reading) {
      const withoutObjectForm = Array.isArray(item.restrictions)
        ? item.restrictions.filter((entry) => entry === null || typeof entry !== 'object')
        : item.restrictions

      const ignoring = visibilityIn(withoutObjectForm, item.jurisdiction)

      expect(
        { case: item.name, visible: ignoring.visible, reason: ignoring.reason },
        `случай «${item.name}» проходит и у реализации, которая форму {code} не читает`,
      ).not.toEqual({ case: item.name, visible: item.visible, reason: item.reason })
    }
  })

  /**
   * Версия 1 заменена и больше не прогоняется. Файл оставлен, а не удалён:
   * удаление стёрло бы и факт, что она была, и дату замены. Но
   * непрогоняемый контракт обязан сам сообщать, что он не действует, —
   * иначе его скопирует следующий, и документ, который читают вместо
   * документов, снова промолчит о своей неполноте.
   */
  it('версия 1 помечена заменённой и этим отличима от действующей', () => {
    expect(supersededV1.status).toContain('заменено версией 2')
  })
})

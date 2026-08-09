import { describe, expect, it } from 'vitest'

import {
  createBlock,
  describeBlock,
  duplicateBlock,
  getNode,
  insertBlock,
  moveBlock,
  removeBlock,
  setProp,
  toBlockList,
  updateNode,
} from './tree-ops'

import type { EditorBlock } from './tree-ops'

function quote(text: string): EditorBlock {
  return { type: 'quote', props: { text } }
}

function columns(children: EditorBlock[]): EditorBlock {
  return { type: 'columns', variant: 'two', props: {}, slots: { columns: children } }
}

const TREE: EditorBlock[] = [quote('раз'), columns([quote('вложенный'), quote('второй')])]

describe('чтение значения поля', () => {
  it('мусор не роняет редактор и не попадает в список', () => {
    expect(toBlockList(null)).toEqual([])
    expect(toBlockList('строка')).toEqual([])
    expect(toBlockList([null, 42, { нет: 'типа' }, quote('да')])).toEqual([quote('да')])
  })
})

describe('новый блок', () => {
  it('получает заготовку пропсов, умолчания стиля и первый вариант', () => {
    const block = createBlock('hero')

    expect(block.type).toBe('hero')
    expect(block.variant).toBe('centered')
    expect(block.props).toMatchObject({ title: '', subtitle: '' })
    expect(block.style).toMatchObject({ theme: 'inherit' })
  })

  it('у типа со слотами слоты созданы пустыми', () => {
    expect(createBlock('columns').slots).toEqual({ columns: [] })
  })

  /** Без источника привязанный блок не проходит проверку — отказ на пустом месте. */
  it('привязанный блок сразу получает источник данных', () => {
    expect(createBlock('news-feed').dataSource).toMatchObject({ collection: 'articles' })
  })

  it('у типа без слотов слотов нет', () => {
    expect(createBlock('quote').slots).toBeUndefined()
  })
})

describe('адресация', () => {
  it('находит узел верхнего уровня и вложенный', () => {
    expect(getNode(TREE, [0])).toEqual(quote('раз'))
    expect(getNode(TREE, [1, 'columns', 1])).toEqual(quote('второй'))
  })

  it('несуществующий адрес возвращает undefined, а не бросает', () => {
    expect(getNode(TREE, [9])).toBeUndefined()
    expect(getNode(TREE, [0, 'columns', 0])).toBeUndefined()
    expect(getNode(TREE, [])).toBeUndefined()
    expect(getNode(TREE, [1, 'нет-такого', 0])).toBeUndefined()
  })
})

describe('правка', () => {
  it('меняет одно свойство, не трогая остальное', () => {
    const next = setProp(TREE, [0], 'text', 'другой')

    expect(getNode(next, [0])?.props).toEqual({ text: 'другой' })
    expect(next[1]).toEqual(TREE[1])
  })

  it('правит вложенный блок', () => {
    const next = setProp(TREE, [1, 'columns', 0], 'text', 'изменён')

    expect(getNode(next, [1, 'columns', 0])?.props).toEqual({ text: 'изменён' })
    expect(getNode(next, [1, 'columns', 1])).toEqual(quote('второй'))
  })

  /** Исходное дерево — значение поля Payload; правка на месте сломала бы отмену. */
  it('не меняет исходное дерево', () => {
    const before = JSON.stringify(TREE)
    setProp(TREE, [1, 'columns', 0], 'text', 'изменён')

    expect(JSON.stringify(TREE)).toBe(before)
  })

  it('правка по несуществующему адресу ничего не ломает', () => {
    expect(updateNode(TREE, [9], (node) => node)).toEqual(TREE)
  })
})

describe('вставка', () => {
  it('добавляет в конец верхнего уровня', () => {
    const next = insertBlock(TREE, [], TREE.length, quote('новый'))

    expect(next).toHaveLength(3)
    expect(next[2]).toEqual(quote('новый'))
  })

  it('добавляет в середину', () => {
    const next = insertBlock(TREE, [], 1, quote('новый'))

    expect(next.map((node) => node.props?.text)).toEqual(['раз', 'новый', undefined])
  })

  it('добавляет в слот', () => {
    const next = insertBlock(TREE, [1, 'columns'], 0, quote('первый'))

    expect(getNode(next, [1, 'columns', 0])).toEqual(quote('первый'))
    expect(next[1]?.slots?.columns).toHaveLength(3)
  })

  /** Позиция вне списка — это добавление в конец, а не промах. */
  it('позиция вне списка означает «в конец»', () => {
    expect(insertBlock(TREE, [], 99, quote('новый'))[2]).toEqual(quote('новый'))
    expect(insertBlock(TREE, [], -5, quote('новый'))[2]).toEqual(quote('новый'))
  })
})

describe('удаление', () => {
  it('удаляет с верхнего уровня', () => {
    expect(removeBlock(TREE, [0])).toHaveLength(1)
  })

  it('удаляет из слота, не трогая соседей', () => {
    const next = removeBlock(TREE, [1, 'columns', 0])

    expect(next[1]?.slots?.columns).toEqual([quote('второй')])
    expect(next[0]).toEqual(quote('раз'))
  })

  it('удаление несуществующего ничего не меняет', () => {
    expect(removeBlock(TREE, [9])).toEqual(TREE)
  })
})

describe('перемещение', () => {
  it('двигает вверх и вниз', () => {
    const down = moveBlock(TREE, [0], 1)

    expect(down[0]?.type).toBe('columns')
    expect(moveBlock(down, [1], -1)).toEqual(TREE)
  })

  it('двигает внутри слота', () => {
    const next = moveBlock(TREE, [1, 'columns', 0], 1)

    expect(next[1]?.slots?.columns?.map((node) => node.props?.text)).toEqual([
      'второй',
      'вложенный',
    ])
  })

  /**
   * Перенос из колонки на верхний уровень — другое действие. Делать его
   * незаметным продолжением «вверх» нельзя: редактор не поймёт, что произошло.
   */
  it('упор в границу списка ничего не меняет', () => {
    expect(moveBlock(TREE, [0], -1)).toEqual(TREE)
    expect(moveBlock(TREE, [1], 1)).toEqual(TREE)
    expect(moveBlock(TREE, [1, 'columns', 0], -1)).toEqual(TREE)
  })
})

describe('дублирование', () => {
  it('ставит копию сразу за оригиналом', () => {
    const next = duplicateBlock(TREE, [0])

    expect(next).toHaveLength(3)
    expect(next[1]).toEqual(quote('раз'))
  })

  it('копирует ветку вместе с содержимым слотов', () => {
    const next = duplicateBlock(TREE, [1])

    expect(next[2]?.slots?.columns).toHaveLength(2)
  })

  /** Поверхностная копия разделила бы слоты, и правка копии меняла бы оригинал. */
  it('копия не разделяет содержимое с оригиналом', () => {
    const next = duplicateBlock(TREE, [1])
    const edited = setProp(next, [2, 'columns', 0], 'text', 'только в копии')

    expect(getNode(edited, [1, 'columns', 0])?.props?.text).toBe('вложенный')
    expect(getNode(edited, [2, 'columns', 0])?.props?.text).toBe('только в копии')
  })
})

describe('подпись узла', () => {
  it('показывает тип и первое заполненное поле', () => {
    expect(describeBlock(quote('Мы работаем с 2011 года'))).toBe('Цитата — Мы работаем с 2011 года')
  })

  it('пустой блок показывает только тип', () => {
    expect(describeBlock(createBlock('quote'))).toBe('Цитата')
  })

  it('длинный текст обрезается', () => {
    expect(describeBlock(quote('я'.repeat(100)))).toContain('…')
  })

  it('неизвестный тип показывает себя, а не пустоту', () => {
    expect(describeBlock({ type: 'выдумка' })).toBe('выдумка')
  })
})

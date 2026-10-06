import { describe, expect, it } from 'vitest'

import { chainFromTenantDoc, tokenSetFromDocs } from './from-docs'

/**
 * Разбор записей и порядок наследования.
 *
 * Читателей двое — сборка релиза и живой предпросмотр палитры, — и оба
 * обязаны получить один набор из одних записей. Пока разбор был один и жил в
 * загрузчике, проверять было нечего; теперь это общее место, и ошибка в нём
 * расходится на оба пути сразу.
 */

const DOCS = {
  primitives: [
    { name: 'color.accent', category: 'color', value: '#111111', owner: 'brand' },
    { name: 'color.accent', category: 'color', value: '#222222', owner: 'site' },
    { name: 'color.only-brand', category: 'color', value: '#333333', owner: 'brand' },
    { name: 'color.чужой', category: 'color', value: '#444444', owner: 'посторонний' },
  ],
  roles: [
    {
      name: 'accent.default',
      group: 'accent',
      light: 'color.accent',
      dark: 'color.accent',
      owner: 'brand',
    },
  ],
  components: [
    { name: 'button.primary.bg', source: 'role', reference: 'accent.default', owner: 'site' },
  ],
}

describe('порядок наследования', () => {
  it('ближний узел перекрывает дальний', () => {
    const set = tokenSetFromDocs(['brand', 'site'], DOCS)

    expect(set.primitives.find((item) => item.name === 'color.accent')?.value).toBe('#222222')
  })

  it('перекрытие идёт по имени: незатронутое значение бренда остаётся', () => {
    const set = tokenSetFromDocs(['brand', 'site'], DOCS)

    expect(set.primitives.find((item) => item.name === 'color.only-brand')?.value).toBe('#333333')
  })

  it('обратный порядок цепочки даёт другой ответ — порядок значим', () => {
    /**
     * Тест-растяжка. Перепутанный порядок означает, что бренд перекрывает
     * сайт: локальная настройка перестаёт действовать, а выглядит это как
     * «почему-то не применилось». Молча.
     */
    const set = tokenSetFromDocs(['site', 'brand'], DOCS)

    expect(set.primitives.find((item) => item.name === 'color.accent')?.value).toBe('#111111')
  })

  it('записи чужих владельцев не попадают в набор', () => {
    const set = tokenSetFromDocs(['brand', 'site'], DOCS)

    expect(set.primitives.map((item) => item.name)).not.toContain('color.чужой')
  })

  it('пустая цепочка даёт пустой набор, а не весь список', () => {
    expect(tokenSetFromDocs([], DOCS)).toEqual({ primitives: [], roles: [], components: [] })
  })

  it('владелец, раскрытый объектом, читается так же, как идентификатором', () => {
    const set = tokenSetFromDocs(['brand'], {
      primitives: [{ name: 'color.a', category: 'color', value: '#000', owner: { id: 'brand' } }],
      roles: [],
      components: [],
    })

    expect(set.primitives).toHaveLength(1)
  })

  it('мусор вместо записи не роняет разбор', () => {
    expect(() =>
      tokenSetFromDocs(['brand'], { primitives: [null, 'строка'], roles: [], components: [] }),
    ).not.toThrow()
  })
})

describe('цепочка из карточки тенанта', () => {
  it('возвращается от дальнего предка к ближнему', () => {
    const doc = { id: 'site', parent: { id: 'region', parent: { id: 'brand', parent: null } } }

    expect(chainFromTenantDoc(doc)).toEqual(['brand', 'region', 'site'])
  })

  it('бренд без родителя — цепочка из одного узла', () => {
    expect(chainFromTenantDoc({ id: 'brand', parent: null })).toEqual(['brand'])
  })

  it('нераскрытый предок обрывает цепочку, а не подставляет половину как целое', () => {
    /**
     * `parent` строкой означает, что глубины запроса не хватило. Взять то,
     * что раскрылось, и молча считать это цепочкой — значит показать палитру
     * без наследования и выдать её за настоящую.
     */
    expect(chainFromTenantDoc({ id: 'site', parent: 'region' })).toEqual(['site'])
  })

  it('цикл не зацикливает', () => {
    const node: Record<string, unknown> = { id: 'a' }
    node.parent = node

    expect(chainFromTenantDoc(node)).toEqual(['a'])
  })

  it('пустой ответ даёт пустую цепочку', () => {
    expect(chainFromTenantDoc(null)).toEqual([])
  })
})

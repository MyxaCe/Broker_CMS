import { describe, expect, it } from 'vitest'

import { emptyProps, validateProps } from './props'
import { BLOCK_REGISTRY, propsOf } from './registry'
import { BLOCK_PROPS } from './registry-props'

import type { PropField } from './props'

const FIELDS: readonly PropField[] = [
  { name: 'title', label: 'Заголовок', kind: 'text', required: true, max: 10 },
  { name: 'count', label: 'Сколько', kind: 'number', min: 1, max: 5 },
  { name: 'shown', label: 'Показывать', kind: 'boolean' },
  {
    name: 'side',
    label: 'Сторона',
    kind: 'select',
    options: [
      { value: 'left', label: 'Слева' },
      { value: 'right', label: 'Справа' },
    ],
  },
  {
    name: 'items',
    label: 'Пункты',
    kind: 'items',
    max: 2,
    of: [{ name: 'text', label: 'Текст', kind: 'text', required: true }],
  },
]

function codes(props: unknown): string[] {
  return validateProps(FIELDS, props).map((issue) => issue.code)
}

describe('проверка пропсов по описанию', () => {
  it('правильные пропсы не дают замечаний', () => {
    expect(validateProps(FIELDS, { title: 'Привет', count: 3, shown: true, side: 'left' })).toEqual(
      [],
    )
  })

  it('незаполненное обязательное поле — расхождение', () => {
    expect(codes({ count: 2 })).toContain('missing-prop')
  })

  /**
   * Неизвестный проп — не «лишнее поле, которое можно проигнорировать»: это
   * опечатка или остаток прежней версии типа, и на витрине его не покажут.
   */
  it('неизвестное свойство отвергается', () => {
    expect(codes({ title: 'Да', подзаголовок: 'нет' })).toContain('unknown-prop')
  })

  it('чужой тип значения отвергается', () => {
    expect(codes({ title: 42 })).toContain('wrong-kind')
    expect(codes({ title: 'Да', count: 'три' })).toContain('wrong-kind')
    expect(codes({ title: 'Да', shown: 'да' })).toContain('wrong-kind')
  })

  it('значение вне перечня отвергается', () => {
    expect(codes({ title: 'Да', side: 'сверху' })).toContain('invalid-option')
  })

  /** Заголовок в полтора экрана ломает вёрстку блока — это видно уже на витрине. */
  it('превышение длины отвергается', () => {
    expect(codes({ title: 'Очень длинный заголовок' })).toContain('too-long')
  })

  it('число вне диапазона отвергается', () => {
    expect(codes({ title: 'Да', count: 99 })).toContain('out-of-range')
  })

  it('превышение количества элементов отвергается', () => {
    const items = [{ text: 'раз' }, { text: 'два' }, { text: 'три' }]

    expect(codes({ title: 'Да', items })).toContain('too-many')
  })

  it('проверка заходит внутрь повторяемой группы', () => {
    const issues = validateProps(FIELDS, { title: 'Да', items: [{ text: '' }] })

    expect(issues[0]).toMatchObject({ code: 'missing-prop', path: 'props.items[0].text' })
  })

  it('пустая строка считается незаполненной, а не значением', () => {
    expect(codes({ title: '' })).toContain('missing-prop')
  })

  it('собирает все расхождения, а не первое', () => {
    expect(codes({ count: 99, side: 'сверху' })).toEqual(
      expect.arrayContaining(['missing-prop', 'out-of-range', 'invalid-option']),
    )
  })

  it('не бросает на мусоре вместо объекта', () => {
    expect(() => validateProps(FIELDS, 'строка')).not.toThrow()
    expect(codes('строка')).toEqual(['wrong-kind'])
    expect(codes(null)).toEqual(['missing-prop'])
  })
})

describe('заготовка нового блока', () => {
  it('содержит все объявленные поля пустыми', () => {
    expect(emptyProps(FIELDS)).toEqual({
      title: '',
      count: 1,
      shown: false,
      side: 'left',
      items: [],
    })
  })

  /**
   * Заготовка не обязана быть валидной — обязательные поля заполняет редактор.
   * Но она обязана не содержать того, чего описание не объявляло.
   */
  it('не содержит неизвестных свойств', () => {
    expect(validateProps(FIELDS, emptyProps(FIELDS)).map((issue) => issue.code)).not.toContain(
      'unknown-prop',
    )
  })
})

describe('согласованность реестра и описаний', () => {
  /**
   * Тип без описания пропсов означает форму без полей: редактор добавит блок
   * и не сможет ничего в нём заполнить.
   */
  it('у каждого типа реестра есть описание пропсов', () => {
    const missing = BLOCK_REGISTRY.filter((block) => BLOCK_PROPS[block.type] === undefined)

    expect(missing.map((block) => block.type)).toEqual([])
  })

  it('описаний нет для типов вне реестра', () => {
    const known = new Set(BLOCK_REGISTRY.map((block) => block.type))
    const extra = Object.keys(BLOCK_PROPS).filter((type) => !known.has(type))

    expect(extra).toEqual([])
  })

  it('у select всегда есть перечень значений', () => {
    const broken: string[] = []

    for (const [type, fields] of Object.entries(BLOCK_PROPS)) {
      for (const field of walkFields(fields)) {
        if (field.kind === 'select' && (field.options ?? []).length === 0) {
          broken.push(`${type}.${field.name}`)
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('у повторяемой группы всегда описан элемент', () => {
    const broken: string[] = []

    for (const [type, fields] of Object.entries(BLOCK_PROPS)) {
      for (const field of walkFields(fields)) {
        if (field.kind === 'items' && (field.of ?? []).length === 0) {
          broken.push(`${type}.${field.name}`)
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('имена полей внутри типа не повторяются', () => {
    const broken: string[] = []

    for (const [type, fields] of Object.entries(BLOCK_PROPS)) {
      const names = fields.map((field) => field.name)

      if (new Set(names).size !== names.length) {
        broken.push(type)
      }
    }

    expect(broken).toEqual([])
  })

  it('заготовка любого типа проходит проверку на неизвестные свойства', () => {
    for (const block of BLOCK_REGISTRY) {
      const fields = propsOf(block.type)
      const issues = validateProps(fields, emptyProps(fields))

      expect(issues.filter((issue) => issue.code === 'unknown-prop')).toEqual([])
    }
  })
})

function walkFields(fields: readonly PropField[]): PropField[] {
  return fields.flatMap((field) => [field, ...walkFields(field.of ?? [])])
}

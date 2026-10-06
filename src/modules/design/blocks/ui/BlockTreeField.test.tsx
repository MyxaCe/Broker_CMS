import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminForm, resetAdminForm } from '@/testing/payload-ui'

import { BlockTreeField } from './BlockTreeField'

/**
 * Конструктор страниц — разметкой первого рендера.
 *
 * Контекст формы Payload подменён заглушкой на двадцать строк
 * (`@/testing/payload-ui`): дороже него конструктор не стоит, и это та самая
 * причина, по которой компонент не покрывался ([[DEBT-018]]).
 *
 * Проверяется **подключённость**, а не поведение. Перенос блоков проверен в
 * `tree-ops.test.ts` до последнего сдвига индексов, но ни один из тех тестов
 * не покраснеет, если ручку перетаскивания забыть нарисовать или зоны приёма
 * не подключить к дереву.
 */

vi.mock('@payloadcms/ui', () => import('@/testing/payload-ui'))

function render(): string {
  return renderToStaticMarkup(<BlockTreeField path="blocks" />)
}

beforeEach(() => {
  resetAdminForm()
})

describe('дерево блоков', () => {
  it('пустое поле говорит, что страница пуста', () => {
    resetAdminForm([])

    expect(render()).toContain('Страница пуста')
  })

  it('считает блоки и показывает каждый', () => {
    resetAdminForm([
      { type: 'hero', props: { title: 'Торгуйте с Apex' } },
      { type: 'quote', props: { text: 'Цитата' } },
    ])

    const html = render()

    expect(html).toContain('Блоков: 2')
    expect(html).toContain('Торгуйте с Apex')
    expect(html).toContain('Цитата')
  })

  it('расхождения проверки показываются числом у шапки', () => {
    /** Герой требует заголовка: блок без него — расхождение дерева. */
    resetAdminForm([{ type: 'hero', props: {} }])

    expect(render()).toContain('Расхождений:')
  })

  it('записи, не похожие на блоки, названы, а не выброшены молча', () => {
    resetAdminForm([{ type: 'quote', props: { text: 'Цитата' } }, 'мусор'])

    expect(render()).toContain('будут потеряны при сохранении')
  })
})

describe('перетаскивание подключено к дереву', () => {
  it('у каждого блока есть ручка переноса', () => {
    resetAdminForm([
      { type: 'quote', props: { text: 'раз' } },
      { type: 'quote', props: { text: 'два' } },
    ])

    const html = render()
    const grips = html.split('data-testid="block-grip"').length - 1

    expect(grips).toBe(2)
  })

  it('зон приёма нет, пока ничего не тащат', () => {
    resetAdminForm([{ type: 'quote', props: { text: 'раз' } }])

    expect(render()).not.toContain('data-testid="block-drop"')
  })

  it('стрелки остались: перенос мышью недоступен с клавиатуры', () => {
    resetAdminForm([
      { type: 'quote', props: { text: 'раз' } },
      { type: 'quote', props: { text: 'два' } },
    ])

    const html = render()

    expect(html).toContain('aria-label="Выше"')
    expect(html).toContain('aria-label="Ниже"')
  })
})

describe('поле формы', () => {
  it('значение читается из формы, а не из документа', () => {
    resetAdminForm([{ type: 'quote', props: { text: 'из формы' } }])

    expect(render()).toContain('из формы')
    expect(adminForm.setValueCalls).toEqual([])
  })
})

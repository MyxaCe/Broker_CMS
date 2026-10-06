import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PropsForm } from './PropsForm'

import type { PropField } from '../props'

/**
 * Форма пропсов — разметкой первого рендера.
 *
 * Проверяется ровно одно: что форма **зовёт** то, что для неё написано.
 * Решения внутри проверяются своими тестами (`media-pick.test.ts`), но ни
 * один из них не краснеет, если контрол перестанет подключаться к полю, —
 * это тот самый класс «написано и не вызывается», измеренный на правиле
 * дисклеймеров.
 */

function render(fields: readonly PropField[], values: Record<string, unknown>): string {
  return renderToStaticMarkup(
    <PropsForm
      fields={fields}
      values={values}
      onChange={() => undefined}
      issues={new Map()}
      idPrefix="blocks[0]"
    />,
  )
}

describe('поле медиа получает выбор из медиатеки, а не поле ввода', () => {
  const fields: readonly PropField[] = [{ name: 'image', label: 'Изображение', kind: 'media' }]

  it('контрол выбора подключён к полю типа media', () => {
    expect(render(fields, {})).toContain('data-testid="media-pick"')
  })

  it('пустое поле честно говорит, что файл не выбран', () => {
    expect(render(fields, {})).toContain('Файл не выбран')
  })

  it('заполненное поле сначала читает карточку, а не рисует картинку наугад', () => {
    const html = render(fields, { image: '42' })

    expect(html).toContain('Читаю карточку файла #42')
    expect(html).not.toContain('Файл не выбран')
  })

  it('идентификатор остаётся правимым: прежние страницы чинятся через интерфейс', () => {
    expect(render(fields, { image: '42' })).toContain('value="42"')
  })
})

describe('остальные типы полей не задеты', () => {
  it('текст остаётся текстом', () => {
    const html = render([{ name: 'title', label: 'Заголовок', kind: 'text' }], { title: 'Апекс' })

    expect(html).toContain('value="Апекс"')
    expect(html).not.toContain('media-pick')
  })

  it('перечень остаётся выпадающим списком', () => {
    const html = render(
      [
        {
          name: 'side',
          label: 'Сторона',
          kind: 'select',
          options: [{ value: 'left', label: 'Слева' }],
        },
      ],
      { side: 'left' },
    )

    expect(html).toContain('<select')
    expect(html).toContain('Слева')
  })

  it('у типа без настроек форма так и говорит', () => {
    expect(render([], {})).toContain('нет настроек')
  })
})

describe('повторяемая группа', () => {
  it('медиа внутри группы тоже получает выбор файла', () => {
    const html = render(
      [
        {
          name: 'logos',
          label: 'Логотипы',
          kind: 'items',
          of: [{ name: 'image', label: 'Логотип', kind: 'media', required: true }],
        },
      ],
      { logos: [{ image: '7' }] },
    )

    expect(html).toContain('data-testid="media-pick"')
    expect(html).toContain('Читаю карточку файла #7')
  })
})

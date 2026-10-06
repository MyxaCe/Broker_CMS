import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminForm, resetAdminForm } from '@/testing/payload-ui'

import { NavTreeField } from './NavTreeField'

/**
 * Редактор меню — разметкой первого рендера.
 *
 * Операции над деревом проверены в `nav-ops.test.ts`, выбор страницы — в
 * `page-options.test.ts`. Здесь проверяется, что редактор ими **пользуется**:
 * показывает дерево, даёт ручку переноса, предлагает страницу списком и не
 * предлагает мега-меню там, где раскрывать нечего.
 */

vi.mock('@payloadcms/ui', () => import('@/testing/payload-ui'))

function render(): string {
  return renderToStaticMarkup(<NavTreeField path="items" />)
}

beforeEach(() => {
  resetAdminForm()
})

describe('дерево меню', () => {
  it('пустое поле говорит, что меню пусто', () => {
    resetAdminForm([])

    expect(render()).toContain('Меню пусто')
  })

  it('показывает подписи пунктов и считает верхний уровень', () => {
    resetAdminForm([
      { label: 'Главная', target: 'page', pageId: '1' },
      { label: 'О компании', target: 'none', children: [{ label: 'История', target: 'page' }] },
    ])

    const html = render()

    expect(html).toContain('Пунктов верхнего уровня: 2')
    expect(html).toContain('value="Главная"')
    expect(html).toContain('value="История"')
  })

  it('расхождения проверки показываются числом и текстом', () => {
    resetAdminForm([{ label: '', target: 'page' }])

    const html = render()

    expect(html).toContain('Расхождений:')
    expect(html).toContain('нет подписи')
  })

  it('записи, не похожие на пункты, названы, а не выброшены молча', () => {
    resetAdminForm([{ label: 'Главная', target: 'page', pageId: '1' }, 'мусор'])

    expect(render()).toContain('будут потеряны при сохранении')
  })
})

describe('выбор страницы вместо ввода идентификатора', () => {
  it('у пункта-страницы есть список страниц, а не поле ввода', () => {
    resetAdminForm([{ label: 'Главная', target: 'page', pageId: '1' }])

    const html = render()

    expect(html).toContain('aria-label="Страница"')
    expect(html).toContain('страница не выбрана')
  })

  it('у внешней ссылки поле адреса, а не список страниц', () => {
    resetAdminForm([{ label: 'Регулятор', target: 'external', href: 'https://example.test' }])

    const html = render()

    expect(html).toContain('aria-label="Внешний адрес"')
    expect(html).not.toContain('aria-label="Страница"')
  })

  it('список заперт, пока его не прочитали, и выбор не выдаётся за удалённую страницу', () => {
    resetAdminForm([{ label: 'Главная', target: 'page', pageId: '1' }])
    adminForm.fields = { owner: { value: '7' }, locale: { value: 'en' } }

    const html = render()

    expect(html).toContain('Читаю список страниц')
    expect(html).toContain('список ещё читается')
    expect(html).not.toContain('которой нет среди страниц')
  })
})

describe('мега-меню', () => {
  it('выбор раскладки есть у пункта с потомками', () => {
    resetAdminForm([
      { label: 'Продукты', target: 'none', children: [{ label: 'Форекс', target: 'page' }] },
    ])

    expect(render()).toContain('Раскрывается как')
  })

  it('и отсутствует у пункта без потомков: раскрывать нечего', () => {
    resetAdminForm([{ label: 'Главная', target: 'page', pageId: '1' }])

    expect(render()).not.toContain('Раскрывается как')
  })
})

describe('перетаскивание подключено', () => {
  it('у каждого пункта есть ручка переноса, включая вложенные', () => {
    resetAdminForm([
      { label: 'Главная', target: 'page', pageId: '1' },
      { label: 'О компании', target: 'none', children: [{ label: 'История', target: 'page' }] },
    ])

    const html = render()

    expect(html.split('data-testid="nav-grip"').length - 1).toBe(3)
  })

  it('зон приёма нет, пока ничего не тащат', () => {
    resetAdminForm([{ label: 'Главная', target: 'page', pageId: '1' }])

    expect(render()).not.toContain('data-testid="nav-drop"')
  })

  it('стрелки остались: перенос мышью недоступен с клавиатуры', () => {
    resetAdminForm([
      { label: 'A', target: 'page', pageId: '1' },
      { label: 'B', target: 'page', pageId: '2' },
    ])

    const html = render()

    expect(html).toContain('aria-label="Выше"')
    expect(html).toContain('aria-label="Ниже"')
  })
})

describe('источник списка страниц', () => {
  it('без владельца и языка объясняет, почему предлагать нечего', () => {
    resetAdminForm([])
    adminForm.fields = { owner: { value: '' }, locale: { value: '' } }

    expect(render()).toContain('Выберите владельца и язык')
  })
})

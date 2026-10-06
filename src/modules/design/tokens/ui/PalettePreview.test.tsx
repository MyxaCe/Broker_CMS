import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAdminForm, adminForm } from '@/testing/payload-ui'

import { draftFromFields, RolePalettePreview } from './PalettePreview'

/**
 * Предпросмотр палитры — разметкой первого рендера и чтением формы.
 *
 * Что он считает, проверено в `preview.test.ts` целиком. Здесь другое: что
 * черновик **снимается с формы**, а не с сохранённого документа. Предпросмотр,
 * читающий документ, показывал бы прошлое значение и был бы не живым, а
 * запоздалым — и ни один тест арифметики этого бы не заметил.
 */

vi.mock('@payloadcms/ui', () => import('@/testing/payload-ui'))

beforeEach(() => {
  resetAdminForm()
})

function fields(values: Record<string, string>): Record<string, { value: unknown }> {
  const parsed: Record<string, { value: unknown }> = {}

  for (const [key, value] of Object.entries(values)) {
    parsed[key] = { value }
  }

  return parsed
}

describe('черновик снимается с состояния формы', () => {
  it('примитив собирается из имени, категории и значения', () => {
    const draft = draftFromFields(
      'primitive',
      fields({ name: 'color.gold', category: 'color', value: '#C9A227' }),
    )

    expect(draft).toEqual({
      level: 'primitive',
      value: { name: 'color.gold', category: 'color', value: '#C9A227' },
    })
  })

  it('роль собирается с обеими темами', () => {
    const draft = draftFromFields(
      'role',
      fields({ name: 'accent.default', group: 'accent', light: 'color.gold', dark: 'color.ink' }),
    )

    expect(draft).toEqual({
      level: 'role',
      value: { name: 'accent.default', group: 'accent', light: 'color.gold', dark: 'color.ink' },
    })
  })

  it('токен компонента по умолчанию ссылается на роль, а не на примитив', () => {
    const draft = draftFromFields(
      'component',
      fields({ name: 'button.primary.bg', reference: 'accent.default' }),
    )

    expect(draft?.level === 'component' ? draft.value.source : null).toBe('role')
  })

  it('безымянный токен черновиком не считается', () => {
    expect(draftFromFields('primitive', fields({ name: '', value: '#fff' }))).toBeNull()
  })

  it('неизвестная категория не ломает черновик и не выдумывает новую', () => {
    const draft = draftFromFields(
      'primitive',
      fields({ name: 'x.y', category: 'выдумка', value: '#fff' }),
    )

    expect(draft?.level === 'primitive' ? draft.value.category : null).toBe('color')
  })
})

describe('предпросмотр подключён к форме', () => {
  it('без владельца объясняет, почему показывать нечего', () => {
    adminForm.fields = { name: { value: 'accent.default' } }

    const html = renderToStaticMarkup(<RolePalettePreview />)

    expect(html).toContain('Выберите владельца')
    expect(html).not.toContain('data-testid="palette-preview"')
  })

  it('с владельцем сначала читает палитру, а не рисует пустую', () => {
    adminForm.fields = { name: { value: 'accent.default' }, owner: { value: '7' } }

    const html = renderToStaticMarkup(<RolePalettePreview />)

    /**
     * Пустая палитра и непрочитанная палитра выглядят одинаково, а означают
     * разное. Отличить обязан интерфейс, а не читатель.
     */
    expect(html).toContain('Читаю палитру владельца')
  })
})

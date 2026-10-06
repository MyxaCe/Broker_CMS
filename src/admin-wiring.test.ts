import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  DesignComponentTokens,
  DesignPrimitives,
  DesignRoles,
  GlobalAreas,
  Pages,
  Sections,
} from '@/modules/design'
import { InstrumentAccess } from '@/modules/trading'

import type { CollectionConfig, Field } from 'payload'

/**
 * Клиентские компоненты админки обязаны быть **подключены**.
 *
 * Заведено по результату мутации: снятие предпросмотра палитры с коллекции не
 * покрасило **ни одного** теста из тысячи с лишним. Компонент написан, его
 * логика проверена, разметка проверена — и он просто не показывается. Тот же
 * класс, что невызываемая `bootstrapEnv` и правило в `.gitignore`, только в
 * интерфейсе.
 *
 * Второе, что здесь проверяется, — **карта импортов**. Она генерируется
 * командой `payload generate:importmap`, и ссылка на компонент, которого в
 * ней нет, роняет страницу админки в рантайме. Это ровно тот отказ, который
 * ни типы, ни линтер не видят: строка подключения — обычная строка.
 */

interface Wiring {
  readonly collection: CollectionConfig
  readonly field: string
  readonly component: string
}

const WIRED: readonly Wiring[] = [
  {
    collection: Pages,
    field: 'blocks',
    component: '@/modules/design/blocks/ui/BlockTreeField#BlockTreeField',
  },
  {
    collection: Sections,
    field: 'blocks',
    component: '@/modules/design/blocks/ui/BlockTreeField#BlockTreeField',
  },
  {
    collection: GlobalAreas,
    field: 'blocks',
    component: '@/modules/design/blocks/ui/BlockTreeField#BlockTreeField',
  },
  {
    collection: DesignPrimitives,
    field: 'palettePreview',
    component: '@/modules/design/tokens/ui/PalettePreview#PrimitivePalettePreview',
  },
  {
    collection: DesignRoles,
    field: 'palettePreview',
    component: '@/modules/design/tokens/ui/PalettePreview#RolePalettePreview',
  },
  {
    collection: DesignComponentTokens,
    field: 'palettePreview',
    component: '@/modules/design/tokens/ui/PalettePreview#ComponentPalettePreview',
  },
  {
    collection: InstrumentAccess,
    field: 'universePicker',
    component: '@/modules/trading/admin/UniversePicker#UniversePicker',
  },
]

/**
 * Карта читается **текстом**, а не импортом. Импорт тянет за собой весь
 * интерфейс админки вместе с его стилями, и быстрый прогон перестал бы быть
 * быстрым — то есть перестал бы запускаться. Проверяется ровно то, что нужно:
 * что ключ в сгенерированном файле есть.
 */
const IMPORT_MAP = readFileSync(
  new URL('./app/(payload)/admin/importMap.js', import.meta.url),
  'utf8',
)

function fieldByName(collection: CollectionConfig, name: string): Field | undefined {
  return collection.fields.find(
    (field) => 'name' in field && (field as { name?: string }).name === name,
  )
}

describe('клиентские компоненты подключены к коллекциям', () => {
  it.each(WIRED)('$collection.slug · $field', ({ collection, field, component }) => {
    const found = fieldByName(collection, field)

    expect(found, `поле «${field}» пропало из коллекции «${collection.slug}»`).toBeDefined()

    const declared = (found as { admin?: { components?: { Field?: unknown } } }).admin?.components
      ?.Field

    expect(declared).toBe(component)
  })

  it.each(WIRED)('$component есть в карте импортов', ({ component }) => {
    /**
     * Карта генерируется, а не пишется руками, — и именно поэтому забывается.
     * Ссылка без записи в карте роняет страницу админки при открытии.
     */
    expect(IMPORT_MAP).toContain(`"${component}"`)
  })
})

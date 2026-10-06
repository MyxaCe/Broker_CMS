import { BRAND_ASSET_SLOTS, readMoneyLayer, readRelationLayer, readSocialsLayer } from './brand'
import { resolveCollection, resolveField } from './inheritance'

import type { BrandAssetSlot } from './brand'
import type {
  CollectionLayerState,
  CollectionResolution,
  FieldResolution,
  LayerState,
  TenantNode,
} from './types'

/**
 * Чтение наследуемых полей тенанта из документа Payload и их разрешение по
 * цепочке `brand → region → site` (ТЗ 3.3).
 *
 * Слой хранится группой `{ mode, value }` или `{ mode, items }`: режим — это
 * заявление редактора («наследую», «переопределяю», «отвязываюсь»), а не
 * следствие того, заполнено значение или нет. Разница существенна: пустое
 * переопределение — осознанное решение, и оно не должно выглядеть как
 * незаполненное поле.
 */

/** Поля, наследуемые по цепочке. Расширяется по мере появления новых. */
export const INHERITABLE_SCALARS = ['jurisdiction', 'defaultLocale', 'primaryColor'] as const
export const INHERITABLE_COLLECTIONS = ['availableLocales'] as const

export type InheritableScalar = (typeof INHERITABLE_SCALARS)[number]
export type InheritableCollection = (typeof INHERITABLE_COLLECTIONS)[number]

export const SCALAR_MODES = ['inherit', 'override', 'fork'] as const
export const COLLECTION_MODES = ['inherit', 'extend', 'fork'] as const

export interface TenantLayerSource {
  readonly node: TenantNode
  readonly data: Record<string, unknown>
}

/**
 * Брендовые ассеты, разрешённые по цепочке (ТЗ 2.1).
 *
 * Наследуются **по слотам, а не блоком целиком**: регион, у которого свой
 * фавикон, не должен терять логотип бренда. Наследование блоком выглядело бы
 * дешевле ровно до первого такого случая, а дальше означало бы копирование
 * чужого логотипа в каждую карточку — то есть потерю связи с источником.
 */
export interface TenantBrand {
  readonly assets: Readonly<Record<BrandAssetSlot, FieldResolution<string>>>
  readonly primaryColor: FieldResolution<string>
  /** Ключ — название сети, значение — ссылка. */
  readonly socials: CollectionResolution<string>
}

export interface TenantSettings {
  readonly jurisdiction: FieldResolution<string>
  readonly defaultLocale: FieldResolution<string>
  readonly availableLocales: CollectionResolution<string>
  /**
   * Стартовый баланс демо-счёта в центах (ТЗ часть 4, Р-027).
   *
   * Живёт в карточке тенанта и наследуется, потому что величина у бренда одна
   * на все его сайты, а исключения бывают страновые. `undefined` означает «не
   * задан ни на одном слое» и наружу уходит как `null`: подставить вместо
   * него правдоподобную тысячу долларов значило бы выдать умолчание за
   * решение владельца.
   */
  readonly demoStartBalanceCents: FieldResolution<number>
  readonly brand: TenantBrand
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Читает слой скалярного поля.
 *
 * Режим `override`/`fork` с пустым значением трактуется как `unset`: иначе
 * в цепочку попадает «переопределение в никуда», которое перекрывает
 * родителя пустотой. Редактор, выбравший режим и не заполнивший поле, почти
 * наверняка не закончил, а не выразил намерение стереть значение.
 */
export function readScalarLayer(raw: unknown): LayerState<string> {
  const group = asRecord(raw)
  const mode = group.mode
  const value = typeof group.value === 'string' ? group.value.trim() : ''

  if (mode !== 'override' && mode !== 'fork') {
    return { state: 'unset' }
  }

  if (value === '') {
    return { state: 'unset' }
  }

  return { state: mode, value }
}

/**
 * Читает слой коллекции. Пустой список при явном режиме сохраняется как есть:
 * для коллекции «ничего своего» — осмысленное состояние, а `fork` с пустым
 * списком означает «отвязаться и не наследовать ничего».
 */
export function readCollectionLayer(raw: unknown): CollectionLayerState<string> {
  const group = asRecord(raw)
  const mode = group.mode

  if (mode !== 'extend' && mode !== 'fork') {
    return { state: 'unset' }
  }

  const rawItems = Array.isArray(group.items) ? group.items : []
  const items = new Map<string, string>()

  for (const entry of rawItems) {
    const code = asRecord(entry).code
    if (typeof code === 'string' && code.trim() !== '') {
      items.set(code.trim(), code.trim())
    }
  }

  return { state: mode, items }
}

export function resolveTenantSettings(layers: readonly TenantLayerSource[]): TenantSettings {
  const chain = layers.map((layer) => layer.node)

  const scalarLayers = (field: InheritableScalar): Map<string, LayerState<string>> =>
    new Map(layers.map((layer) => [layer.node.id, readScalarLayer(layer.data[field])]))

  const collectionLayers = (
    field: InheritableCollection,
  ): Map<string, CollectionLayerState<string>> =>
    new Map(layers.map((layer) => [layer.node.id, readCollectionLayer(layer.data[field])]))

  const relationLayers = (field: string): Map<string, LayerState<string>> =>
    new Map(layers.map((layer) => [layer.node.id, readRelationLayer(layer.data[field])]))

  const assets = Object.fromEntries(
    BRAND_ASSET_SLOTS.map((slot) => [slot, resolveField(chain, relationLayers(slot))]),
  ) as Record<BrandAssetSlot, FieldResolution<string>>

  return {
    jurisdiction: resolveField(chain, scalarLayers('jurisdiction')),
    defaultLocale: resolveField(chain, scalarLayers('defaultLocale')),
    availableLocales: resolveCollection(chain, collectionLayers('availableLocales')),
    demoStartBalanceCents: resolveField(
      chain,
      new Map(
        layers.map((layer) => [layer.node.id, readMoneyLayer(layer.data.demoStartBalanceCents)]),
      ),
    ),
    brand: {
      assets,
      primaryColor: resolveField(chain, scalarLayers('primaryColor')),
      socials: resolveCollection(
        chain,
        new Map(layers.map((layer) => [layer.node.id, readSocialsLayer(layer.data.socials)])),
      ),
    },
  }
}

/**
 * Проверки, которые невозможно выполнить по одному документу: они опираются на
 * РАЗРЕШЁННОЕ значение, то есть на всю цепочку.
 *
 * Именно поэтому обязательность юрисдикции проверяется здесь, а не в правилах
 * карточки: сайт вправе не задавать её у себя, если она приходит от региона.
 * Требовать локальное значение означало бы отменить наследование ровно для
 * того поля, ради которого оно в первую очередь и нужно.
 */
export function validateResolvedSettings(
  kind: TenantNode['kind'],
  settings: TenantSettings,
): string[] {
  if (kind !== 'site') {
    return []
  }

  const issues: string[] = []

  if (settings.jurisdiction.value === undefined) {
    issues.push(
      'jurisdiction: не задана ни у сайта, ни выше по цепочке — без неё невозможно определить обязательные предупреждения и запрещённые продукты (ADR-0003)',
    )
  }

  const locales = settings.availableLocales.entries.map((entry) => entry.value)

  if (locales.length === 0) {
    issues.push(
      'availableLocales: у сайта должна быть хотя бы одна локаль — своя или унаследованная',
    )
  }

  const defaultLocale = settings.defaultLocale.value

  if (defaultLocale === undefined) {
    issues.push('defaultLocale: не задана ни у сайта, ни выше по цепочке')
  } else if (locales.length > 0 && !locales.includes(defaultLocale)) {
    issues.push(
      `defaultLocale: "${defaultLocale}" отсутствует среди разрешённых локалей (${locales.join(', ')})`,
    )
  }

  return issues
}

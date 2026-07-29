import type { Role } from '../auth/roles'

export type { Role }

/**
 * Уровни цепочки наследования (ТЗ 3.3): `brand (корень) → region → site`.
 *
 * Уровень — не ярлык, а правило: он определяет, кто может быть родителем и
 * может ли у узла быть потомки. Проверяется в `buildChain`.
 */
export type TenantKind = 'brand' | 'region' | 'site'

export interface TenantNode {
  readonly id: string
  readonly slug: string
  readonly kind: TenantKind
  /** `null` только у корня. */
  readonly parentId: string | null
}

/**
 * Состояние поля на конкретном слое цепочки.
 *
 * `unset`    — слой ничего не сказал, значение приходит сверху;
 * `override` — локальное значение, связь с родителем сохранена;
 * `fork`     — отвязка от наследования: изменения родителя сюда больше не приходят.
 *
 * Для скалярного поля `override` и `fork` дают одинаковый результат — разница
 * видна на коллекциях, где форк перестаёт принимать новые элементы родителя.
 * Разделение сохранено и для скаляров, потому что это заявление о намерении:
 * «я переопределил» и «я отвязался» — разные решения редактора, и в аудите
 * они должны выглядеть по-разному.
 */
export type LayerState<T> =
  | { readonly state: 'unset' }
  | { readonly state: 'override'; readonly value: T }
  | { readonly state: 'fork'; readonly value: T }

/** Что показывает бейдж источника рядом с полем в админке (ТЗ 3.3). */
export type Provenance = 'unset' | 'inherited' | 'overridden' | 'forked'

export interface FieldResolution<T> {
  readonly value: T | undefined
  readonly provenance: Provenance
  /** Тенант, чьё значение победило. `null`, если значения нет ни на одном слое. */
  readonly sourceTenantId: string | null
  /** Что получится после «вернуть к наследуемому» — то есть если убрать локальный слой. */
  readonly inheritedValue: T | undefined
  readonly inheritedFromTenantId: string | null
}

/**
 * Слой коллекции: библиотека блоков, набор шаблонов страниц, правовой каркас.
 *
 * `extend` — слой добавляет и переопределяет элементы, продолжая получать
 *            новые элементы родителя;
 * `fork`   — слой берёт снимок и дальше живёт сам: новые элементы родителя
 *            сюда не приезжают.
 */
export type CollectionLayerState<T> =
  | { readonly state: 'unset' }
  | { readonly state: 'extend'; readonly items: ReadonlyMap<string, T> }
  | { readonly state: 'fork'; readonly items: ReadonlyMap<string, T> }

export interface CollectionEntry<T> {
  readonly key: string
  readonly value: T
  readonly provenance: Provenance
  readonly sourceTenantId: string
}

export interface CollectionResolution<T> {
  readonly entries: readonly CollectionEntry<T>[]
  /** Тенант, на котором произошла отвязка. `null` — цепочка целиком связная. */
  readonly forkedAtTenantId: string | null
}

/**
 * Действующее лицо запроса. Намеренно не тип пользователя Payload: правило
 * доступа не должно зависеть от формы записи в БД.
 */
export interface Actor {
  readonly id: string
  readonly role: Role
  readonly isActive: boolean
  /** Явная привязка к тенантам. Пустой список означает «ничего не видит». */
  readonly tenantIds: readonly string[]
}

/**
 * Решение о доступе. `allow-tenants` несёт готовый перечень идентификаторов —
 * его подставляют в условие выборки, а не в фильтр интерфейса.
 */
export type AccessDecision =
  | { readonly kind: 'deny' }
  | { readonly kind: 'allow-all' }
  | { readonly kind: 'allow-tenants'; readonly tenantIds: readonly string[] }

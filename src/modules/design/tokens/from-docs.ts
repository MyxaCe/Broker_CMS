import { mergeTokenSets } from './resolve'

import type { ComponentToken, Primitive, SemanticRole, TokenSet } from './types'

/**
 * Превращение записей базы в набор токенов (ТЗ 2.1).
 *
 * Вынесено отдельно, потому что читателей теперь двое: сборка релиза на
 * сервере и живой предпросмотр палитры в админке ([[DEBT-011]]). Оба обязаны
 * получить **один и тот же набор** из одних и тех же записей — иначе
 * предпросмотр показывает не то, что соберётся.
 *
 * Самое хрупкое здесь — не разбор полей, а **порядок слияния**. Он идёт от
 * дальнего предка к ближнему, и перепутанный порядок означает, что бренд
 * перекрывает сайт: локальная настройка перестаёт действовать, а выглядит это
 * как «почему-то не применилось».
 */

export interface TokenDocs {
  readonly primitives: readonly unknown[]
  readonly roles: readonly unknown[]
  readonly components: readonly unknown[]
}

export function ownerIdOf(doc: Record<string, unknown>): string {
  const owner = doc.owner

  if (owner !== null && typeof owner === 'object' && 'id' in owner) {
    return String((owner as { id: unknown }).id)
  }

  return owner === null || owner === undefined ? '' : String(owner)
}

export function toPrimitive(doc: Record<string, unknown>): Primitive {
  return {
    name: String(doc.name),
    category: doc.category as Primitive['category'],
    value: String(doc.value),
  }
}

export function toRole(doc: Record<string, unknown>): SemanticRole {
  return {
    name: String(doc.name),
    group: doc.group as SemanticRole['group'],
    light: String(doc.light),
    dark: String(doc.dark),
  }
}

export function toComponent(doc: Record<string, unknown>): ComponentToken {
  return {
    name: String(doc.name),
    source: doc.source as ComponentToken['source'],
    reference: String(doc.reference),
  }
}

function pick<T>(
  docs: readonly unknown[],
  ownerId: string,
  map: (doc: Record<string, unknown>) => T,
): T[] {
  return (docs as Record<string, unknown>[])
    .filter((doc) => doc !== null && typeof doc === 'object' && ownerIdOf(doc) === ownerId)
    .map((doc) => map(doc))
}

/**
 * Собирает набор по цепочке тенантов.
 *
 * `chain` — от дальнего предка к ближнему. Плоский список записей сортировать
 * нельзя: порядок выдачи базы не совпадает с порядком наследования, и
 * перекрытие получилось бы случайным.
 */
export function tokenSetFromDocs(chain: readonly string[], docs: TokenDocs): TokenSet {
  if (chain.length === 0) {
    return { primitives: [], roles: [], components: [] }
  }

  return mergeTokenSets(
    chain.map((id) => ({
      primitives: pick<Primitive>(docs.primitives, id, toPrimitive),
      roles: pick<SemanticRole>(docs.roles, id, toRole),
      components: pick<ComponentToken>(docs.components, id, toComponent),
    })),
  )
}

/**
 * Цепочка владельцев из карточки тенанта с раскрытыми предками.
 *
 * Возвращается **от дальнего предка к ближнему** — в том порядке, в котором
 * наборы сливаются. Запрос вида `/api/tenants/{id}?depth=3` раскрывает
 * `parent` объектом; больше трёх уровней у нас не бывает (бренд → регион →
 * сайт), а если вдруг появится, цепочка оборвётся на нераскрытом предке — и
 * это лучше, чем молча взять половину.
 */
export function chainFromTenantDoc(doc: unknown): string[] {
  const chain: string[] = []
  let node: unknown = doc
  /** Защита от цикла: карточка приходит из сети и может ссылаться сама на себя. */
  const seen = new Set<string>()

  while (node !== null && typeof node === 'object' && 'id' in node) {
    const record = node as Record<string, unknown>
    const id = String(record.id)

    if (seen.has(id)) {
      break
    }

    seen.add(id)
    chain.unshift(id)
    node = record.parent
  }

  return chain
}

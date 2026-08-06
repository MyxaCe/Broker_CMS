import { TOKEN_NAME_PATTERN, THEMES } from './types'

import type { ComponentToken, Primitive, SemanticRole, Theme, TokenSet } from './types'

/**
 * Разрешение графа токенов (ТЗ 2.1).
 *
 * Две задачи, и обе про то, чтобы ошибка была видна раньше, чем сайт:
 *
 *  1. **наследование** — набор сайта складывается из наборов бренда, региона и
 *     собственного, где ближний перекрывает дальний по имени;
 *  2. **разрешение ссылок** — компонент → роль → примитив, до сырого значения,
 *     отдельно для каждой темы.
 */

export class TokenResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenResolutionError'
  }
}

export interface TokenIssue {
  readonly code:
    'unknown-primitive' | 'unknown-role' | 'duplicate-name' | 'invalid-name' | 'missing-theme'
  readonly name: string
  readonly message: string
}

/**
 * Сливает наборы по цепочке наследования.
 *
 * Порядок аргументов — от дальнего предка к ближнему: бренд, регион, сайт.
 * Перекрытие идёт **по имени токена**, а не по всему набору: сайт, меняющий
 * один акцент, не обязан переобъявлять всю палитру. Обратное поведение
 * (набор целиком или ничего) заставляло бы копировать сотни значений ради
 * одной правки, и копии немедленно разошлись бы.
 */
export function mergeTokenSets(sets: readonly TokenSet[]): TokenSet {
  const primitives = new Map<string, Primitive>()
  const roles = new Map<string, SemanticRole>()
  const components = new Map<string, ComponentToken>()

  for (const set of sets) {
    for (const primitive of set.primitives) primitives.set(primitive.name, primitive)
    for (const role of set.roles) roles.set(role.name, role)
    for (const component of set.components) components.set(component.name, component)
  }

  return {
    primitives: [...primitives.values()],
    roles: [...roles.values()],
    components: [...components.values()],
  }
}

export interface ResolvedTokens {
  /** Тема → имя токена → сырое значение. */
  readonly byTheme: Readonly<Record<Theme, Readonly<Record<string, string>>>>
  /** Тема → имя роли → сырое значение. Нужно отдельно для проверки контраста. */
  readonly rolesByTheme: Readonly<Record<Theme, Readonly<Record<string, string>>>>
  /** Что не сошлось. Пустой список — набор пригоден к сборке. */
  readonly issues: readonly TokenIssue[]
}

/**
 * Разрешает набор до сырых значений по каждой теме.
 *
 * **Не бросает.** Набор с битой ссылкой — обычное состояние черновика: роль
 * уже создана, примитив ещё нет. Исключение здесь означало бы, что админка
 * падает на полпути редактирования. Вместо этого возвращается список
 * расхождений, а сборка релиза не пропускает набор с непустым списком.
 */
export function resolveTokens(set: TokenSet): ResolvedTokens {
  const issues: TokenIssue[] = []

  const primitives = indexByName(set.primitives, issues, 'примитив')
  const roles = indexByName(set.roles, issues, 'роль')
  const components = indexByName(set.components, issues, 'токен компонента')

  const rolesByTheme: Record<Theme, Record<string, string>> = { light: {}, dark: {} }

  for (const role of roles.values()) {
    for (const theme of THEMES) {
      const reference = role[theme]

      if (typeof reference !== 'string' || reference === '') {
        issues.push({
          code: 'missing-theme',
          name: role.name,
          message: `У роли «${role.name}» не задано значение для темы «${theme}». Обе темы обязательны.`,
        })
        continue
      }

      const primitive = primitives.get(reference)

      if (primitive === undefined) {
        issues.push({
          code: 'unknown-primitive',
          name: role.name,
          message: `Роль «${role.name}» (${theme}) ссылается на несуществующий примитив «${reference}».`,
        })
        continue
      }

      rolesByTheme[theme][role.name] = primitive.value
    }
  }

  const byTheme: Record<Theme, Record<string, string>> = { light: {}, dark: {} }

  /** Примитивы одинаковы в обеих темах: тему задаёт роль, а не сырое значение. */
  for (const theme of THEMES) {
    for (const primitive of primitives.values()) {
      byTheme[theme][primitive.name] = primitive.value
    }

    for (const [name, value] of Object.entries(rolesByTheme[theme])) {
      byTheme[theme][name] = value
    }
  }

  for (const component of components.values()) {
    for (const theme of THEMES) {
      const value =
        component.source === 'role'
          ? rolesByTheme[theme][component.reference]
          : primitives.get(component.reference)?.value

      if (value === undefined) {
        /**
         * Расхождение объявляется один раз, а не по разу на тему: причина одна
         * — отсутствующая ссылка, и дублировать её в отчёте значит утомить
         * читателя вдвое.
         */
        if (theme === 'light') {
          issues.push({
            code: component.source === 'role' ? 'unknown-role' : 'unknown-primitive',
            name: component.name,
            message: `Токен «${component.name}» ссылается на несуществующ${
              component.source === 'role' ? 'ую роль' : 'ий примитив'
            } «${component.reference}».`,
          })
        }

        continue
      }

      byTheme[theme][component.name] = value
    }
  }

  return { byTheme, rolesByTheme, issues }
}

/**
 * Индексирует по имени, попутно проверяя имя и уникальность.
 *
 * Повтор имени внутри одного узла — это ошибка, а не перекрытие: перекрытие
 * бывает только между узлами цепочки, и там оно осознанно. Внутри одного
 * набора два токена с одним именем означают, что один из них не действует, и
 * какой именно — вопрос порядка чтения из базы.
 */
function indexByName<T extends { name: string }>(
  items: readonly T[],
  issues: TokenIssue[],
  kind: string,
): Map<string, T> {
  const index = new Map<string, T>()

  for (const item of items) {
    if (!TOKEN_NAME_PATTERN.test(item.name)) {
      issues.push({
        code: 'invalid-name',
        name: item.name,
        message: `Имя «${item.name}» (${kind}) не соответствует формату: строчные сегменты через точку.`,
      })
      continue
    }

    if (index.has(item.name)) {
      issues.push({
        code: 'duplicate-name',
        name: item.name,
        message: `Имя «${item.name}» (${kind}) объявлено дважды в одном наборе.`,
      })
      continue
    }

    index.set(item.name, item)
  }

  return index
}

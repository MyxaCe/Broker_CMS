/**
 * Дизайн-токены (ТЗ 2.1).
 *
 * Трёхуровневый граф, и уровни существуют не для красоты:
 *
 *   примитив          `color.gold.500 = #C9A227`   — сырое значение
 *        ↓
 *   семантическая     `text.primary`               — смысл, свой в каждой теме
 *   роль
 *        ↓
 *   токен компонента  `button.primary.bg`          — применение роли
 *
 * Смысл разделения в направлении правки. Дизайнер меняет `accent.default` —
 * и меняются все кнопки, ссылки и акценты разом. Если бы компонент ссылался
 * на примитив напрямую, смена акцента означала бы обход всех компонентов, а
 * забытый остался бы старого цвета.
 */

/** Категории примитивов из ТЗ 2.1. */
export const PRIMITIVE_CATEGORIES = [
  'color',
  'space',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'radius',
  'shadow',
  'duration',
] as const

export type PrimitiveCategory = (typeof PRIMITIVE_CATEGORIES)[number]

export const PRIMITIVE_CATEGORY_LABELS: Record<PrimitiveCategory, string> = {
  color: 'Цвет',
  space: 'Отступ',
  fontSize: 'Размер шрифта',
  fontWeight: 'Начертание',
  lineHeight: 'Межстрочный интервал',
  radius: 'Скругление',
  shadow: 'Тень',
  duration: 'Длительность',
}

/**
 * Обе темы обязательны (ТЗ 2.1).
 *
 * Не «светлая и опционально тёмная»: сайт брокера читают ночью с телефона, и
 * тёмная тема, собранная наспех, — это тот же непройденный контраст, только
 * заметный не всем.
 */
export const THEMES = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

/**
 * Группы семантических ролей из ТЗ 2.1.
 *
 * `market` помечен в ТЗ как общий с терминалом: рост и падение обязаны
 * выглядеть одинаково на сайте и в торговом окне, иначе человек читает
 * график неправильно.
 */
export const ROLE_GROUPS = ['surface', 'text', 'border', 'accent', 'state', 'market'] as const

export type RoleGroup = (typeof ROLE_GROUPS)[number]

export const ROLE_GROUP_LABELS: Record<RoleGroup, string> = {
  surface: 'Поверхности',
  text: 'Текст',
  border: 'Границы',
  accent: 'Акцент',
  state: 'Состояния',
  market: 'Рынок (общее с терминалом)',
}

/**
 * Токен компонента ссылается либо на семантическую роль (цвета), либо прямо
 * на примитив (размеры, скругления, тени, длительности).
 *
 * Смысловой слой для нецветовых величин ТЗ не описывает, и выдумывать его
 * незачем: `card.radius = radius.md` читается однозначно, а промежуточная
 * роль `radius.card` не добавила бы ничего, кроме ещё одного места правки.
 */
export const TOKEN_SOURCES = ['role', 'primitive'] as const

export type TokenSource = (typeof TOKEN_SOURCES)[number]

/** Имя токена: точки разделяют уровни, сегменты в нижнем регистре. */
export const TOKEN_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/

export interface Primitive {
  readonly name: string
  readonly category: PrimitiveCategory
  readonly value: string
}

export interface SemanticRole {
  readonly name: string
  readonly group: RoleGroup
  /** Ссылки на примитивы — по одной на тему. Обе обязательны. */
  readonly light: string
  readonly dark: string
}

export interface ComponentToken {
  readonly name: string
  readonly source: TokenSource
  /** Имя роли либо примитива — в зависимости от `source`. */
  readonly reference: string
}

/** Полный набор токенов одного узла дерева тенантов. */
export interface TokenSet {
  readonly primitives: readonly Primitive[]
  readonly roles: readonly SemanticRole[]
  readonly components: readonly ComponentToken[]
}

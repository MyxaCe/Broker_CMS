import { THEMES } from './types'

import type { ResolvedTokens } from './resolve'
import type { Theme } from './types'

/**
 * Экспорт токенов (ТЗ 2.1: «CSS custom properties для веба + JSON для
 * терминала и мобильного»).
 *
 * Оба формата собираются из **одного разрешённого набора**. Это и есть смысл
 * упражнения: веб и терминал обязаны показывать один и тот же красный, а два
 * независимых экспорта разошлись бы при первой же правке.
 */

/**
 * Префикс переменных.
 *
 * Без него `--accent-default` столкнётся с переменной, объявленной чужой
 * библиотекой на той же странице, и выиграет та, что объявлена позже.
 */
export const CSS_VARIABLE_PREFIX = '--bkc'

/**
 * Имя токена в имя переменной CSS.
 *
 * Точки заменяются дефисами: точка в имени пользовательского свойства
 * допустима не везде и читается хуже.
 */
export function cssVariableName(token: string): string {
  return `${CSS_VARIABLE_PREFIX}-${token.replace(/\./g, '-')}`
}

/**
 * Экранирование значения.
 *
 * Значение приходит из админки, то есть от человека. Точка с запятой или
 * закрывающая скобка в нём разорвали бы правило и позволили дописать своё —
 * это инъекция в таблицу стилей, а не опечатка.
 */
export function sanitizeCssValue(value: string): string {
  return value.replace(/[;{}<>]/g, '').trim()
}

export interface CssExportOptions {
  /**
   * Селектор светлой темы. Тёмная выводится и по атрибуту, и по системной
   * настройке: пользователь мог не выбирать тему явно, и тогда решает система.
   */
  readonly lightSelector?: string
  readonly darkSelector?: string
}

/**
 * CSS custom properties для веба.
 *
 * Тёмная тема выводится дважды: по явному атрибуту и внутри
 * `prefers-color-scheme`. Только медиазапроса недостаточно — переключатель
 * темы на сайте перестал бы работать; только атрибута — тёмная тема не
 * включилась бы у того, кто её не выбирал, но выбрал в системе.
 */
export function toCssCustomProperties(
  resolved: ResolvedTokens,
  options: CssExportOptions = {},
): string {
  const lightSelector = options.lightSelector ?? ':root'
  const darkSelector = options.darkSelector ?? '[data-theme="dark"]'

  const block = (selector: string, theme: Theme): string => {
    const declarations = Object.entries(resolved.byTheme[theme])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => `  ${cssVariableName(name)}: ${sanitizeCssValue(value)};`)
      .join('\n')

    return `${selector} {\n${declarations}\n}`
  }

  return [
    block(lightSelector, 'light'),
    block(darkSelector, 'dark'),
    `@media (prefers-color-scheme: dark) {\n${block('  :root:not([data-theme="light"])', 'dark')
      .split('\n')
      .map((line) => (line === '' ? line : `  ${line}`))
      .join('\n')}\n}`,
  ].join('\n\n')
}

export interface TokenJsonExport {
  readonly schemaVersion: string
  readonly themes: Readonly<Record<Theme, Readonly<Record<string, string>>>>
}

/**
 * Версия формата экспорта.
 *
 * Отдельная от версии контракта выдачи: терминал и мобильное читают этот файл
 * напрямую, и его форма меняется по своим поводам.
 */
export const TOKEN_EXPORT_SCHEMA_VERSION = 'tokens-v1'

/**
 * JSON для терминала и мобильного.
 *
 * Ключи отсортированы: без этого один и тот же набор даёт разные байты от
 * прогона к прогону, и `ETag` перестаёт означать «то же самое».
 */
export function toTokenJson(resolved: ResolvedTokens): TokenJsonExport {
  const themes = {} as Record<Theme, Record<string, string>>

  for (const theme of THEMES) {
    themes[theme] = Object.fromEntries(
      Object.entries(resolved.byTheme[theme]).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    )
  }

  return { schemaVersion: TOKEN_EXPORT_SCHEMA_VERSION, themes }
}

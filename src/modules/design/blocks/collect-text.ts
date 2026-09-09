import { collectBlocks } from '../compliance/rules'

import { BLOCK_PROPS } from './registry-props'

import type { PropField } from './props'
import type { ContentClass, TextItem } from '../forbidden-claims'

/**
 * Извлечение редакторских текстов из дерева блоков (ТЗ 2.4).
 *
 * Нужно стоп-словарю обещаний доходности: проверять он умел с самого начала,
 * но текстов ему не передавали, и месяц он отвечал «нарушений нет», не увидев
 * ни строки (DEBT-013).
 *
 * Обходить дерево «по всем строкам подряд» нельзя: адрес ссылки, идентификатор
 * файла и код варианта — тоже строки, и стоп-словарь спотыкался бы о них. Что
 * является текстом, знает описание пропсов типа — то самое, из которого
 * выводится форма редактора. Один источник на форму и на проверку означает,
 * что новый текстовый проп попадает под стоп-словарь сам, без правки здесь.
 */

/** Виды пропсов, содержащие редакторский текст. Остальные — служебные значения. */
const TEXT_KINDS: ReadonlySet<string> = new Set(['text', 'textarea', 'richtext'])

export interface CollectTextsArgs {
  /** Человекочитаемое начало адреса находки: «страница /about (de)». */
  readonly location: string
  readonly contentClass: ContentClass
  /** Префикс пути внутри дерева. Совпадает с тем, что использует комплаенс. */
  readonly prefix?: string
}

/**
 * Собирает тексты из дерева блоков.
 *
 * Не бросает ни при каком входе: дерево приходит полем JSON, и повреждённая
 * ветка не должна отменять проверку остальных — иначе одна опечатка снова
 * превращает гейт в молчание.
 */
export function collectTexts(blocks: unknown, args: CollectTextsArgs): TextItem[] {
  const found: TextItem[] = []

  for (const block of collectBlocks(blocks, args.prefix ?? 'blocks')) {
    const fields = BLOCK_PROPS[block.type]

    /**
     * Неизвестный тип пропускаем молча: о нём уже сообщит проверка дерева
     * блоков, а вторая жалоба на то же самое только удлиняет отчёт.
     */
    if (fields === undefined) {
      continue
    }

    collectFromFields(fields, block.props, `${args.location} · ${block.path}`, args, found)
  }

  return found
}

function collectFromFields(
  fields: readonly PropField[],
  props: unknown,
  location: string,
  args: CollectTextsArgs,
  found: TextItem[],
): void {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    return
  }

  const record = props as Record<string, unknown>

  for (const field of fields) {
    const value = record[field.name]

    if (TEXT_KINDS.has(field.kind)) {
      if (typeof value === 'string' && value.trim() !== '') {
        found.push({
          location: `${location}.${field.name}`,
          contentClass: args.contentClass,
          text: value,
        })
      }

      continue
    }

    /**
     * Повторяемые группы — пункты FAQ, строки тарифной сетки, шаги открытия
     * счёта. Обещание доходности в третьей строке таблицы — такое же
     * нарушение, как в заголовке, и пропускать его потому, что оно лежит
     * глубже, было бы произволом.
     */
    if (field.kind === 'items' && Array.isArray(value) && field.of !== undefined) {
      value.forEach((item, index) => {
        collectFromFields(field.of ?? [], item, `${location}.${field.name}[${index}]`, args, found)
      })
    }
  }
}

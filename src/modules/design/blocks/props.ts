/**
 * Описание пропсов блока (ТЗ 2.2).
 *
 * Существует ради двух вещей сразу, и это не совпадение:
 *
 *  · **форма редактора выводится отсюда**, а не пишется руками для каждого из
 *    трёх десятков типов. Тридцать шесть форм разъехались бы по мелочам —
 *    где-то подпись, где-то обязательность, где-то предел длины;
 *  · **пропсы проверяются**. До этого описания блок мог нести что угодно:
 *    тип и вариант сверялись с реестром, а содержимое — ни с чем.
 *
 * Язык описания закрытый и намеренно бедный. Богатый язык означал бы, что в
 * блоке можно выразить произвольную структуру, а вместе с ней — произвольную
 * вёрстку, которой у нас нет: вёрстку рисует компонент, а не редактор.
 */

export const PROP_KINDS = [
  'text',
  'textarea',
  'richtext',
  'number',
  'boolean',
  'select',
  'media',
  'link',
  /** Повторяемая группа: пункты FAQ, строки таблицы, шаги. */
  'items',
] as const

export type PropKind = (typeof PROP_KINDS)[number]

export interface PropOption {
  readonly value: string
  readonly label: string
}

export interface PropField {
  readonly name: string
  readonly label: string
  readonly kind: PropKind
  readonly required?: boolean
  /** Только для `select`. Перечень закрытый — свободного значения не бывает. */
  readonly options?: readonly PropOption[]
  /** Только для `items`. Описание одного элемента группы. */
  readonly of?: readonly PropField[]
  /** Предел длины для текста и количества для группы. */
  readonly max?: number
  readonly min?: number
  readonly help?: string
}

export interface PropIssue {
  readonly code:
    | 'unknown-prop'
    | 'missing-prop'
    | 'wrong-kind'
    | 'invalid-option'
    | 'too-long'
    | 'too-many'
    | 'out-of-range'
  readonly path: string
  readonly message: string
}

/**
 * Проверяет пропсы блока по описанию его типа.
 *
 * Не бросает: пропсы приходят из поля JSON. Неизвестный проп — расхождение, а
 * не «лишнее поле, которое можно проигнорировать»: он означает либо опечатку,
 * либо остаток от прежней версии типа, и в обоих случаях на витрине его никто
 * не покажет, а редактор будет считать, что показал.
 */
export function validateProps(
  fields: readonly PropField[],
  props: unknown,
  path = 'props',
): PropIssue[] {
  if (props === null || props === undefined) {
    return fields.filter((field) => field.required === true).map((field) => missing(field, path))
  }

  if (typeof props !== 'object' || Array.isArray(props)) {
    return [{ code: 'wrong-kind', path, message: 'Пропсы должны быть объектом.' }]
  }

  const record = props as Record<string, unknown>
  const issues: PropIssue[] = []
  const known = new Map(fields.map((field) => [field.name, field]))

  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      issues.push({
        code: 'unknown-prop',
        path: `${path}.${key}`,
        message: `Свойство «${key}» не объявлено у этого типа блока.`,
      })
    }
  }

  for (const field of fields) {
    const value = record[field.name]
    const where = `${path}.${field.name}`

    if (value === null || value === undefined || value === '') {
      if (field.required === true) {
        issues.push(missing(field, path))
      }

      continue
    }

    issues.push(...checkValue(field, value, where))
  }

  return issues
}

function missing(field: PropField, path: string): PropIssue {
  return {
    code: 'missing-prop',
    path: `${path}.${field.name}`,
    message: `Не заполнено обязательное свойство «${field.label}».`,
  }
}

function checkValue(field: PropField, value: unknown, path: string): PropIssue[] {
  switch (field.kind) {
    case 'text':
    case 'textarea':
    case 'richtext':
    case 'media':
    case 'link':
      return checkText(field, value, path)

    case 'number':
      return checkNumber(field, value, path)

    case 'boolean':
      return typeof value === 'boolean'
        ? []
        : [{ code: 'wrong-kind', path, message: `«${field.label}»: ожидался флаг.` }]

    case 'select':
      return checkSelect(field, value, path)

    case 'items':
      return checkItems(field, value, path)

    default:
      return []
  }
}

function checkText(field: PropField, value: unknown, path: string): PropIssue[] {
  if (typeof value !== 'string') {
    return [{ code: 'wrong-kind', path, message: `«${field.label}»: ожидался текст.` }]
  }

  if (field.max !== undefined && value.length > field.max) {
    /**
     * Предел длины — не украшательство: заголовок в полтора экрана ломает
     * вёрстку блока, а описание длиннее предела поисковика обрезается на
     * середине фразы.
     */
    return [
      {
        code: 'too-long',
        path,
        message: `«${field.label}»: ${value.length} символов при пределе ${field.max}.`,
      },
    ]
  }

  return []
}

function checkNumber(field: PropField, value: unknown, path: string): PropIssue[] {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return [{ code: 'wrong-kind', path, message: `«${field.label}»: ожидалось число.` }]
  }

  if (
    (field.min !== undefined && value < field.min) ||
    (field.max !== undefined && value > field.max)
  ) {
    return [
      {
        code: 'out-of-range',
        path,
        message: `«${field.label}»: значение ${value} вне допустимого диапазона.`,
      },
    ]
  }

  return []
}

function checkSelect(field: PropField, value: unknown, path: string): PropIssue[] {
  const allowed = (field.options ?? []).map((option) => option.value)

  if (typeof value !== 'string' || !allowed.includes(value)) {
    return [
      {
        code: 'invalid-option',
        path,
        message: `«${field.label}»: допустимы только ${allowed.join(', ') || '—'}.`,
      },
    ]
  }

  return []
}

function checkItems(field: PropField, value: unknown, path: string): PropIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: 'wrong-kind', path, message: `«${field.label}»: ожидался список.` }]
  }

  const issues: PropIssue[] = []

  if (field.max !== undefined && value.length > field.max) {
    issues.push({
      code: 'too-many',
      path,
      message: `«${field.label}»: ${value.length} элементов при пределе ${field.max}.`,
    })
  }

  value.forEach((entry, index) => {
    issues.push(...validateProps(field.of ?? [], entry, `${path}[${index}]`))
  })

  return issues
}

/** Пустое значение для поля — то, с чего начинается новый блок в конструкторе. */
export function emptyValue(field: PropField): unknown {
  switch (field.kind) {
    case 'boolean':
      return false
    case 'items':
      return []
    case 'number':
      return field.min ?? 0
    case 'select':
      return field.options?.[0]?.value ?? ''
    default:
      return ''
  }
}

/** Заготовка пропсов нового блока: все объявленные поля, пустые. */
export function emptyProps(fields: readonly PropField[]): Record<string, unknown> {
  const props: Record<string, unknown> = {}

  for (const field of fields) {
    props[field.name] = emptyValue(field)
  }

  return props
}

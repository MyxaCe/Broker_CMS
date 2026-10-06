'use client'

import { emptyProps } from '../props'

import { MediaPicker } from './MediaPicker'

import type { PropField } from '../props'

/**
 * Форма пропсов, выведенная из описания типа ([[DEBT-011]]).
 *
 * Одна форма на все три десятка типов. Написанные руками формы разъехались бы
 * по мелочам — где подпись, где обязательность, где предел длины, — и
 * разъехались бы именно с тем описанием, по которому потом проверяется сборка.
 */
export function PropsForm(props: {
  readonly fields: readonly PropField[]
  readonly values: Record<string, unknown>
  readonly onChange: (name: string, value: unknown) => void
  /** Расхождения, найденные проверкой, — по имени поля. */
  readonly issues: ReadonlyMap<string, string>
  readonly idPrefix: string
}): React.JSX.Element | null {
  if (props.fields.length === 0) {
    return <p className="block-form__empty">У этого типа блока нет настроек.</p>
  }

  return (
    <div className="block-form">
      {props.fields.map((field) => (
        <PropRow
          key={field.name}
          field={field}
          value={props.values[field.name]}
          issue={props.issues.get(field.name)}
          id={`${props.idPrefix}-${field.name}`}
          onChange={(value) => props.onChange(field.name, value)}
          issues={props.issues}
          idPrefix={props.idPrefix}
        />
      ))}
    </div>
  )
}

function PropRow(props: {
  readonly field: PropField
  readonly value: unknown
  readonly issue: string | undefined
  readonly id: string
  readonly onChange: (value: unknown) => void
  readonly issues: ReadonlyMap<string, string>
  readonly idPrefix: string
}): React.JSX.Element {
  const { field } = props

  return (
    <div className={`block-form__row${props.issue === undefined ? '' : ' block-form__row--bad'}`}>
      <label className="block-form__label" htmlFor={props.id}>
        {field.label}
        {field.required === true ? (
          <span className="block-form__required"> ·&nbsp;обязательно</span>
        ) : null}
      </label>

      <Control {...props} />

      {field.help !== undefined ? <p className="block-form__help">{field.help}</p> : null}
      {props.issue !== undefined ? <p className="block-form__issue">{props.issue}</p> : null}
    </div>
  )
}

function Control(props: {
  readonly field: PropField
  readonly value: unknown
  readonly id: string
  readonly onChange: (value: unknown) => void
  readonly issues: ReadonlyMap<string, string>
  readonly idPrefix: string
}): React.JSX.Element {
  const { field, value } = props

  switch (field.kind) {
    case 'textarea':
    case 'richtext':
      return (
        <textarea
          id={props.id}
          className="block-form__input"
          rows={field.kind === 'richtext' ? 8 : 3}
          value={typeof value === 'string' ? value : ''}
          maxLength={field.max}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )

    case 'number':
      return (
        <input
          id={props.id}
          className="block-form__input"
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            props.onChange(event.target.value === '' ? '' : Number(event.target.value))
          }
        />
      )

    case 'boolean':
      return (
        <input
          id={props.id}
          className="block-form__checkbox"
          type="checkbox"
          checked={value === true}
          onChange={(event) => props.onChange(event.target.checked)}
        />
      )

    case 'select':
      return (
        <select
          id={props.id}
          className="block-form__input"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'media':
      /**
       * Выбор из медиатеки ([[DEBT-011]], ADR-0034). Своя панель, а не виджет
       * Payload: встроенный `upload` живёт в поле документа, а здесь поле —
       * это одна ветка дерева внутри `json`, и формы, в которую его можно
       * повесить, не существует.
       */
      return <MediaPicker id={props.id} value={value} onChange={props.onChange} />

    case 'items':
      return <ItemsControl {...props} />

    default:
      return (
        <input
          id={props.id}
          className="block-form__input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          maxLength={field.max}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )
  }
}

/** Повторяемая группа: пункты FAQ, шаги, строки таблицы. */
function ItemsControl(props: {
  readonly field: PropField
  readonly value: unknown
  readonly id: string
  readonly onChange: (value: unknown) => void
  readonly issues: ReadonlyMap<string, string>
  readonly idPrefix: string
}): React.JSX.Element {
  const items = Array.isArray(props.value) ? (props.value as Record<string, unknown>[]) : []
  const of = props.field.of ?? []
  const full = props.field.max !== undefined && items.length >= props.field.max

  const replace = (index: number, next: Record<string, unknown>) => {
    const copy = [...items]
    copy[index] = next
    props.onChange(copy)
  }

  return (
    <div className="block-items">
      {items.map((item, index) => (
        <div key={index} className="block-items__entry">
          <div className="block-items__head">
            <span className="block-items__number">{index + 1}</span>
            <div className="block-items__controls">
              <button
                type="button"
                className="block-tree__button"
                disabled={index === 0}
                onClick={() => props.onChange(swap(items, index, index - 1))}
                aria-label="Выше"
              >
                ↑
              </button>
              <button
                type="button"
                className="block-tree__button"
                disabled={index === items.length - 1}
                onClick={() => props.onChange(swap(items, index, index + 1))}
                aria-label="Ниже"
              >
                ↓
              </button>
              <button
                type="button"
                className="block-tree__button block-tree__button--danger"
                onClick={() => props.onChange(items.filter((_, at) => at !== index))}
              >
                Удалить
              </button>
            </div>
          </div>

          <PropsForm
            fields={of}
            values={item ?? {}}
            issues={props.issues}
            idPrefix={`${props.id}-${index}`}
            onChange={(name, value) => replace(index, { ...(item ?? {}), [name]: value })}
          />
        </div>
      ))}

      <button
        type="button"
        className="block-tree__button"
        disabled={full}
        onClick={() => props.onChange([...items, emptyProps(of)])}
      >
        {full ? `Предел — ${props.field.max}` : 'Добавить'}
      </button>
    </div>
  )
}

function swap(
  items: readonly Record<string, unknown>[],
  from: number,
  to: number,
): Record<string, unknown>[] {
  const copy = [...items]
  const moved = copy[from]
  const target = copy[to]

  if (moved === undefined || target === undefined) {
    return copy
  }

  copy[from] = target
  copy[to] = moved

  return copy
}

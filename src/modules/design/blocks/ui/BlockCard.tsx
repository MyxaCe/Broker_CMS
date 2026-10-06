'use client'

import { useState } from 'react'

import { findBlock, propsOf } from '../registry'
import { BLOCK_ALIGNMENTS, BLOCK_THEMES, BLOCK_WIDTHS, PADDING_STEPS } from '../style'

import { BlockPicker } from './BlockPicker'
import { PropsForm } from './PropsForm'
import { describeBlock } from './tree-ops'

import type { BlockPath, EditorBlock } from './tree-ops'
import type { TreeIssue } from '../validate-tree'

/**
 * Один блок в конструкторе ([[DEBT-011]]).
 *
 * Рекурсивен: слот содержит такие же карточки. Расхождения показываются
 * **у блока**, а не общим списком внизу — список из тридцати строк «где-то в
 * дереве» читатель не сопоставит с блоками.
 */
export function BlockCard(props: {
  readonly node: EditorBlock
  readonly path: BlockPath
  readonly issues: readonly TreeIssue[]
  readonly allowRestricted: boolean
  readonly first: boolean
  readonly last: boolean
  /** Адрес блока, который сейчас тащат, либо `null`. */
  readonly dragging: BlockPath | null
  readonly onDragStart: (path: BlockPath) => void
  readonly onDragEnd: () => void
  readonly onChange: (path: BlockPath, name: string, value: unknown) => void
  readonly onStyle: (path: BlockPath, name: string, value: unknown) => void
  readonly onVariant: (path: BlockPath, variant: string) => void
  readonly onMove: (path: BlockPath, delta: number) => void
  readonly onRemove: (path: BlockPath) => void
  readonly onDuplicate: (path: BlockPath) => void
  readonly onAdd: (listPath: BlockPath, index: number, type: string) => void
  readonly renderList: (listPath: BlockPath, list: readonly EditorBlock[]) => React.JSX.Element
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)

  const definition = findBlock(props.node.type)
  const here = `${pathKey(props.path)}`

  /** Расхождения этого блока — без вложенных: те покажет их собственная карточка. */
  const own = props.issues.filter(
    (issue) => issue.path.startsWith(here) && !issue.path.slice(here.length).includes('.slots.'),
  )

  const propIssues = new Map<string, string>()

  for (const issue of own) {
    const match = /\.props\.([^.[]+)/.exec(issue.path)

    if (match?.[1] !== undefined) {
      propIssues.set(match[1], issue.message)
    }
  }

  const style = (props.node.style ?? {}) as Record<string, unknown>

  const moving = props.dragging !== null && pathKey(props.dragging) === here

  return (
    <li
      className={`block-card${own.length > 0 ? ' block-card--bad' : ''}${
        moving ? ' block-card--moving' : ''
      }`}
    >
      <div className="block-card__head">
        {/*
         * Тащат за ручку, а не за карточку целиком. Карточка содержит поля
         * ввода: `draggable` на ней отнимает у них выделение текста мышью —
         * правка подписи превращается в перенос блока.
         */}
        <span
          className="block-card__grip"
          draggable
          role="button"
          tabIndex={-1}
          aria-label="Перетащить блок"
          title="Перетащить блок"
          data-testid="block-grip"
          onDragStart={(event) => {
            /**
             * Полезная нагрузка не используется — адрес берётся из состояния
             * поля. Но без `setData` Firefox перетаскивание не начинает вовсе.
             */
            event.dataTransfer.setData('text/plain', here)
            event.dataTransfer.effectAllowed = 'move'
            props.onDragStart(props.path)
          }}
          onDragEnd={props.onDragEnd}
        >
          ⠿
        </span>

        <button
          type="button"
          className="block-card__toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} {describeBlock(props.node)}
        </button>

        {own.length > 0 ? <span className="block-card__badge">{own.length}</span> : null}

        <div className="block-card__controls">
          {/*
           * Стрелки остались, и это решение, а не недоделка. Перетаскивание
           * мышью недоступно с клавиатуры, а редактор, работающий только
           * клавишами, обязан уметь переставить блок. ТЗ требует
           * перетаскивания — не требует отмены всего остального.
           */}
          <button
            type="button"
            className="block-tree__button"
            disabled={props.first}
            onClick={() => props.onMove(props.path, -1)}
            aria-label="Выше"
          >
            ↑
          </button>
          <button
            type="button"
            className="block-tree__button"
            disabled={props.last}
            onClick={() => props.onMove(props.path, 1)}
            aria-label="Ниже"
          >
            ↓
          </button>
          <button
            type="button"
            className="block-tree__button"
            onClick={() => props.onDuplicate(props.path)}
          >
            Копия
          </button>
          <button
            type="button"
            className="block-tree__button block-tree__button--danger"
            onClick={() => props.onRemove(props.path)}
          >
            Удалить
          </button>
        </div>
      </div>

      {definition === undefined ? (
        <p className="block-form__issue">
          Тип «{props.node.type}» отсутствует в реестре. Такой блок не опубликуется — удалите его
          или попросите разработчика добавить тип.
        </p>
      ) : null}

      {open ? (
        <div className="block-card__body">
          {definition !== undefined && definition.variants.length > 0 ? (
            <div className="block-form__row">
              <label className="block-form__label" htmlFor={`${here}-variant`}>
                Вариант
              </label>
              <select
                id={`${here}-variant`}
                className="block-form__input"
                value={props.node.variant ?? ''}
                onChange={(event) => props.onVariant(props.path, event.target.value)}
              >
                {definition.variants.map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <PropsForm
            fields={propsOf(props.node.type)}
            values={(props.node.props ?? {}) as Record<string, unknown>}
            issues={propIssues}
            idPrefix={here}
            onChange={(name, value) => props.onChange(props.path, name, value)}
          />

          <details className="block-card__style">
            <summary>Оформление</summary>
            <div className="block-form">
              <StyleRow
                id={`${here}-theme`}
                label="Тема"
                value={style.theme}
                options={BLOCK_THEMES}
                onChange={(value) => props.onStyle(props.path, 'theme', value)}
              />
              <StyleRow
                id={`${here}-width`}
                label="Ширина"
                value={style.width}
                options={BLOCK_WIDTHS}
                onChange={(value) => props.onStyle(props.path, 'width', value)}
              />
              <StyleRow
                id={`${here}-padding`}
                label="Отступ"
                value={style.paddingY}
                options={PADDING_STEPS}
                onChange={(value) => props.onStyle(props.path, 'paddingY', value)}
              />
              <StyleRow
                id={`${here}-align`}
                label="Выравнивание"
                value={style.align}
                options={BLOCK_ALIGNMENTS}
                onChange={(value) => props.onStyle(props.path, 'align', value)}
              />
            </div>
            <p className="block-form__help">
              Свободного оформления нет: значения берутся только из перечней дизайн-системы.
            </p>
          </details>

          {(definition?.slots ?? []).map((slot) => {
            const children = props.node.slots?.[slot] ?? []
            const listPath = [...props.path, slot]

            return (
              <div key={slot} className="block-card__slot">
                <h5 className="block-card__slot-title">Слот «{slot}»</h5>

                {props.renderList(listPath, children)}

                {adding === slot ? (
                  <BlockPicker
                    into={slot}
                    allowRestricted={props.allowRestricted}
                    onCancel={() => setAdding(null)}
                    onPick={(type) => {
                      props.onAdd(listPath, children.length, type)
                      setAdding(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="block-tree__button"
                    onClick={() => setAdding(slot)}
                  >
                    Добавить в «{slot}»
                  </button>
                )}
              </div>
            )
          })}

          {own
            .filter((issue) => !issue.path.includes('.props.'))
            .map((issue) => (
              <p key={`${issue.code}-${issue.path}`} className="block-form__issue">
                {issue.message}
              </p>
            ))}
        </div>
      ) : null}
    </li>
  )
}

function StyleRow(props: {
  readonly id: string
  readonly label: string
  readonly value: unknown
  readonly options: readonly string[]
  readonly onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="block-form__row">
      <label className="block-form__label" htmlFor={props.id}>
        {props.label}
      </label>
      <select
        id={props.id}
        className="block-form__input"
        value={typeof props.value === 'string' ? props.value : ''}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Адрес узла в том же виде, в каком его пишет проверка дерева: `blocks[0].slots.x[1]`. */
export function pathKey(path: BlockPath): string {
  let key = 'blocks'

  for (let step = 0; step < path.length; step += 1) {
    const part = path[step]

    key += typeof part === 'number' ? `[${part}]` : `.slots.${part}`
  }

  return key
}

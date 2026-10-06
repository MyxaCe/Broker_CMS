'use client'

import { useState } from 'react'

import { canDropInto } from './tree-ops'

import type { BlockPath, EditorBlock } from './tree-ops'

/**
 * Место, куда можно отпустить блок ([[DEBT-011]], ADR-0034).
 *
 * Зона — это **промежуток между карточками**, а не сама карточка. Карточка
 * как цель означала бы «положить до или после, смотря где курсор», то есть
 * угадывание по половине высоты; промежуток отвечает на вопрос однозначно.
 *
 * Отказ показывается **до отпускания**: причина пишется прямо в зоне, а сама
 * зона перестаёт принимать. Иначе редактор отпускает кнопку и ничего не
 * происходит — ровно то поведение, которое читается как «не работает».
 */
export function DropZone(props: {
  readonly tree: readonly EditorBlock[]
  readonly dragging: BlockPath | null
  readonly listPath: BlockPath
  readonly index: number
  readonly onDrop: (listPath: BlockPath, index: number) => void
}): React.JSX.Element | null {
  const [over, setOver] = useState(false)

  if (props.dragging === null) {
    return null
  }

  const verdict = canDropInto(props.tree, props.dragging, props.listPath)
  const allowed = verdict.kind === 'allow'

  return (
    <li
      className={`block-tree__drop${over ? ' block-tree__drop--over' : ''}${
        allowed ? '' : ' block-tree__drop--refused'
      }`}
      data-testid="block-drop"
      onDragOver={(event) => {
        if (!allowed) {
          return
        }

        /** Без этого браузер не считает зону целью и курсор показывает запрет. */
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => {
        setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)

        if (allowed) {
          props.onDrop(props.listPath, props.index)
        }
      }}
    >
      {allowed ? null : <span className="block-tree__drop-reason">{verdict.reason}</span>}
    </li>
  )
}

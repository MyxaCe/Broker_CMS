'use client'

import { useMemo, useState } from 'react'

import { BLOCK_GROUP_LABELS, BLOCK_GROUPS, BLOCK_REGISTRY } from '../registry'

import type { BlockDefinition, BlockGroup } from '../registry'

/**
 * Выбор типа блока из реестра ([[DEBT-011]]).
 *
 * Список приходит из того же реестра, что проверяет сборку релиза. Отдельный
 * перечень «что показывать редактору» разошёлся бы с тем, «что пропускает
 * проверка», и разошёлся бы в худшую сторону: редактор добавлял бы блок,
 * который не публикуется.
 */
export function BlockPicker(props: {
  readonly onPick: (type: string) => void
  readonly onCancel: () => void
  /** Показывать ли блоки, доступные только кросс-тенантной роли. */
  readonly allowRestricted: boolean
  /** Слот, куда добавляют. Нужен только для подписи. */
  readonly into?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')

  const available = useMemo(
    () => BLOCK_REGISTRY.filter((block) => block.restricted !== true || props.allowRestricted),
    [props.allowRestricted],
  )

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return available
    }

    return available.filter(
      (block) =>
        block.title.toLowerCase().includes(needle) || block.type.toLowerCase().includes(needle),
    )
  }, [available, query])

  const byGroup = useMemo(() => {
    const groups = new Map<BlockGroup, BlockDefinition[]>()

    for (const block of matched) {
      groups.set(block.group, [...(groups.get(block.group) ?? []), block])
    }

    return groups
  }, [matched])

  return (
    <div className="block-picker">
      <div className="block-picker__head">
        <input
          className="block-picker__search"
          type="search"
          value={query}
          autoFocus
          placeholder="Найти блок"
          aria-label="Найти блок"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="block-tree__button" onClick={props.onCancel}>
          Отмена
        </button>
      </div>

      {props.into !== undefined ? (
        <p className="block-picker__hint">Добавить в слот «{props.into}»</p>
      ) : null}

      {matched.length === 0 ? (
        <p className="block-picker__hint">Ничего не найдено. Реестр расширяется разработчиком.</p>
      ) : null}

      {BLOCK_GROUPS.map((group) => {
        const blocks = byGroup.get(group) ?? []

        if (blocks.length === 0) {
          return null
        }

        return (
          <section key={group} className="block-picker__group">
            <h4 className="block-picker__group-title">{BLOCK_GROUP_LABELS[group]}</h4>
            <div className="block-picker__grid">
              {blocks.map((block) => (
                <button
                  key={block.type}
                  type="button"
                  className="block-picker__item"
                  onClick={() => props.onPick(block.type)}
                >
                  <span className="block-picker__item-title">{block.title}</span>
                  {block.restricted === true ? (
                    <span className="block-picker__badge">только разработчику</span>
                  ) : null}
                  {block.boundTo !== undefined ? (
                    <span className="block-picker__badge">данные: {block.boundTo}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

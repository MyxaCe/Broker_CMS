'use client'

import { useField } from '@payloadcms/ui'
import { Fragment, useMemo, useState } from 'react'

import { validateBlockTree } from '../validate-tree'

import { BlockCard, pathKey } from './BlockCard'
import { BlockPicker } from './BlockPicker'
import { DropZone } from './DropZone'
import {
  createBlock,
  insertBlock,
  duplicateBlock,
  moveBlock,
  moveBlockTo,
  removeBlock,
  setProp,
  toBlockList,
  updateNode,
} from './tree-ops'

import './block-tree.css'

import type { BlockPath, EditorBlock } from './tree-ops'

/**
 * Конструктор страниц ([[DEBT-011]], ТЗ 2.2).
 *
 * Поле остаётся тем же JSON в базе — меняется только то, чем его правят.
 * Это не косметика: до этого собрать страницу мог разработчик и не мог тот,
 * для кого CMS делается.
 *
 * Проверка дерева здесь **та же**, что на сохранении и на сборке релиза:
 * своя, «редакторская», расходилась бы с настоящей, и редактор узнавал бы о
 * расхождении при публикации.
 */
export function BlockTreeField({ path }: { readonly path: string }): React.JSX.Element {
  const { value, setValue } = useField<unknown>({ path })
  const [adding, setAdding] = useState(false)

  /**
   * Что сейчас тащат. Состояние держится здесь, а не в карточке: зоны
   * приёма принадлежат спискам на всех уровнях дерева, и каждая обязана
   * знать, что именно к ней несут, — иначе она не может ответить «сюда
   * нельзя» до отпускания кнопки.
   */
  const [dragging, setDragging] = useState<BlockPath | null>(null)

  const tree = useMemo(() => toBlockList(value), [value])

  /**
   * Роли токенов редактору здесь неизвестны: они разрешаются по цепочке
   * тенанта на сервере. Поэтому проверка оформления по ролям остаётся за
   * сборкой релиза, а тут проверяется всё остальное — состав, пропсы,
   * вложенность. Показывать заведомо ложное «роль не найдена» на каждый блок
   * было бы хуже, чем не показывать ничего.
   */
  const issues = useMemo(
    () => validateBlockTree(tree, { roles: new Set<string>(), allowRestricted: true }),
    [tree],
  )

  const apply = (next: EditorBlock[]) => setValue(next)

  const drop = (listPath: BlockPath, index: number) => {
    if (dragging !== null) {
      apply(moveBlockTo(tree, dragging, listPath, index))
    }

    setDragging(null)
  }

  const renderList = (listPath: BlockPath, list: readonly EditorBlock[]): React.JSX.Element => (
    <ol className={`block-tree__list${dragging === null ? '' : ' block-tree__list--dragging'}`}>
      <DropZone tree={tree} dragging={dragging} listPath={listPath} index={0} onDrop={drop} />
      {list.map((node, index) => (
        <Fragment key={`${pathKey([...listPath, index])}-${node.type}`}>
          <BlockCard
            node={node}
            path={[...listPath, index]}
            issues={issues}
            allowRestricted
            first={index === 0}
            last={index === list.length - 1}
            dragging={dragging}
            onDragStart={(at) => {
              setDragging(at)
            }}
            onDragEnd={() => {
              setDragging(null)
            }}
            onChange={(at, name, propValue) => apply(setProp(tree, at, name, propValue))}
            onStyle={(at, name, styleValue) =>
              apply(
                updateNode(tree, at, (node) => ({
                  ...node,
                  style: { ...(node.style ?? {}), [name]: styleValue },
                })),
              )
            }
            onVariant={(at, variant) =>
              apply(updateNode(tree, at, (node) => ({ ...node, variant })))
            }
            onMove={(at, delta) => apply(moveBlock(tree, at, delta))}
            onRemove={(at) => apply(removeBlock(tree, at))}
            onDuplicate={(at) => apply(duplicateBlock(tree, at))}
            onAdd={(into, at, type) => apply(insertBlock(tree, into, at, createBlock(type)))}
            renderList={renderList}
          />
          <DropZone
            tree={tree}
            dragging={dragging}
            listPath={listPath}
            index={index + 1}
            onDrop={drop}
          />
        </Fragment>
      ))}
    </ol>
  )

  return (
    <div className="block-tree">
      <div className="block-tree__head">
        <span className="block-tree__count">
          {tree.length === 0 ? 'Страница пуста' : `Блоков: ${tree.length}`}
        </span>
        {issues.length > 0 ? (
          <span className="block-tree__count block-tree__count--bad">
            Расхождений: {issues.length}
          </span>
        ) : null}
      </div>

      {Array.isArray(value) && value.length !== tree.length ? (
        <p className="block-form__issue">
          В поле есть записи, которые не похожи на блоки — они не показаны и будут потеряны при
          сохранении из конструктора.
        </p>
      ) : null}

      {renderList([], tree)}

      {adding ? (
        <BlockPicker
          allowRestricted
          onCancel={() => setAdding(false)}
          onPick={(type) => {
            apply(insertBlock(tree, [], tree.length, createBlock(type)))
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="block-tree__button block-tree__button--primary"
          onClick={() => setAdding(true)}
        >
          Добавить блок
        </button>
      )}
    </div>
  )
}

export default BlockTreeField

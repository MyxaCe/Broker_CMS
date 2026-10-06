'use client'

import { useField, useFormFields } from '@payloadcms/ui'
import { Fragment, useEffect, useMemo, useState } from 'react'

import {
  NAV_LAYOUT_LABELS,
  NAV_LAYOUTS,
  NAV_TARGET_LABELS,
  NAV_TARGETS,
  validateNavTree,
} from '../tree'

import {
  canDropNav,
  createNavItem,
  insertNavItem,
  moveNavItem,
  moveNavItemTo,
  removeNavItem,
  setNavField,
  toNavList,
} from './nav-ops'
import {
  describeOption,
  describePageChoice,
  pageOptions,
  siteIdsUnder,
  tenantRows,
  warnAboutForeignPages,
} from './page-options'

import './nav-tree.css'

import type { EditorNavItem, NavPath } from './nav-ops'
import type { PageOption } from './page-options'

/**
 * Редактор меню деревом (ТЗ 2.2, [[DEBT-011]], ADR-0034).
 *
 * > «Навигация — отдельная древовидная структура со своим редактором, а не
 * > массив ссылок»
 *
 * Модель была собрана полностью, включая признак мега-меню (ADR-0033);
 * правилась она полем JSON. Это и есть та разница, ради которой дерево
 * хранит ссылку на страницу, а не адрес: выбрать страницу из списка можно
 * только в редакторе, а в текстовом поле остаётся вписывать число.
 */

const MAX_PAGES = 500

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

type Source =
  | { readonly kind: 'loading' }
  | { readonly kind: 'incomplete'; readonly reason: string }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | {
      readonly kind: 'ready'
      readonly options: readonly PageOption[]
      readonly warning: string | null
    }

const INCOMPLETE_CONTEXT: Source = {
  kind: 'incomplete',
  reason:
    'Выберите владельца и язык — список страниц зависит от обоих, и без них предлагать нечего.',
}

function pathKey(path: NavPath): string {
  return `nav[${path.join('][')}]`
}

export function NavTreeField({ path }: { readonly path: string }): React.JSX.Element {
  const { value, setValue } = useField<unknown>({ path })

  /** Владелец и локаль — из состояния формы: меню правят до сохранения. */
  const context = useFormFields(([fields]) => {
    const owner = fields?.owner?.value
    const locale = fields?.locale?.value

    return `${String(owner ?? '')}\u0000${String(locale ?? '')}`
  })

  const [ownerId = '', locale = ''] = context.split('\u0000')

  const tree = useMemo(() => toNavList(value), [value])
  const [source, setSource] = useState<Source>({ kind: 'loading' })
  const [dragging, setDragging] = useState<NavPath | null>(null)

  useEffect(() => {
    if (ownerId === '' || locale === '') {
      setSource(INCOMPLETE_CONTEXT)

      return
    }

    let alive = true

    void (async () => {
      try {
        const sites = siteIdsUnder(
          tenantRows(await getJson('/api/tenants?limit=0&depth=0')),
          ownerId,
        )

        if (!alive) {
          return
        }

        if (sites.length === 0) {
          setSource({
            kind: 'incomplete',
            reason:
              'У этого владельца нет ни одного сайта — страниц, на которые можно сослаться, тоже нет.',
          })

          return
        }

        const where = sites
          .map((id, index) => `where[site][in][${index}]=${encodeURIComponent(id)}`)
          .join('&')

        const pages = await getJson(
          `/api/pages?limit=${MAX_PAGES}&depth=0&where[locale][equals]=${encodeURIComponent(locale)}&${where}`,
        )

        if (alive) {
          setSource({
            kind: 'ready',
            options: pageOptions(pages),
            warning: warnAboutForeignPages(sites),
          })
        }
      } catch (error) {
        if (alive) {
          setSource({
            kind: 'unreadable',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [ownerId, locale])

  /**
   * Проверка — **та же**, что на сохранении меню. Своя, «редакторская»,
   * расходилась бы с настоящей, и редактор узнавал бы о расхождении от
   * сервера. Список известных страниц здесь пуст намеренно: целостность
   * ссылок проверяется при сборке релиза, а не при правке (см. `tree.ts`).
   */
  const issues = useMemo(() => validateNavTree(tree, { knownPages: new Set<string>() }), [tree])

  const options = source.kind === 'ready' ? source.options : []
  const apply = (next: EditorNavItem[]) => setValue(next)

  const drop = (parentPath: NavPath, index: number) => {
    if (dragging !== null) {
      apply(moveNavItemTo(tree, dragging, parentPath, index))
    }

    setDragging(null)
  }

  const renderList = (parentPath: NavPath, list: readonly EditorNavItem[]): React.JSX.Element => (
    <ol className="nav-tree__list">
      <NavDropZone
        tree={tree}
        dragging={dragging}
        parentPath={parentPath}
        index={0}
        onDrop={drop}
      />
      {list.map((item, index) => (
        <Fragment key={`${pathKey([...parentPath, index])}`}>
          <NavItemCard
            item={item}
            path={[...parentPath, index]}
            issues={issues}
            options={options}
            first={index === 0}
            last={index === list.length - 1}
            dragging={dragging}
            sourceReady={source.kind === 'ready'}
            onDragStart={setDragging}
            onDragEnd={() => {
              setDragging(null)
            }}
            onField={(at, name, next) => apply(setNavField(tree, at, name, next))}
            onMove={(at, delta) => apply(moveNavItem(tree, at, delta))}
            onRemove={(at) => apply(removeNavItem(tree, at))}
            onAddChild={(at) =>
              apply(insertNavItem(tree, at, Number.MAX_SAFE_INTEGER, createNavItem()))
            }
            renderList={renderList}
          />
          <NavDropZone
            tree={tree}
            dragging={dragging}
            parentPath={parentPath}
            index={index + 1}
            onDrop={drop}
          />
        </Fragment>
      ))}
    </ol>
  )

  return (
    <div className="nav-tree">
      <div className="nav-tree__head">
        <span className="nav-tree__count">
          {tree.length === 0 ? 'Меню пусто' : `Пунктов верхнего уровня: ${tree.length}`}
        </span>
        {issues.length > 0 ? (
          <span className="nav-tree__count nav-tree__count--bad">Расхождений: {issues.length}</span>
        ) : null}
      </div>

      {/*
       * Незаполненные владелец и язык читаются из формы напрямую, а не
       * ожидаются от эффекта: иначе редактор сначала сообщает «читаю список
       * страниц», то есть о работе, которой не было.
       */}
      <SourceBanner source={ownerId === '' || locale === '' ? INCOMPLETE_CONTEXT : source} />

      {Array.isArray(value) && value.length !== tree.length ? (
        <p className="nav-tree__issue">
          В поле есть записи, которые не похожи на пункты меню — они не показаны и будут потеряны
          при сохранении из редактора.
        </p>
      ) : null}

      {renderList([], tree)}

      <button
        type="button"
        className="nav-tree__button nav-tree__button--primary"
        onClick={() => {
          apply(insertNavItem(tree, [], tree.length, createNavItem()))
        }}
      >
        Добавить пункт
      </button>
    </div>
  )
}

function SourceBanner({ source }: { readonly source: Source }): React.JSX.Element | null {
  if (source.kind === 'loading') {
    return <p className="nav-tree__note">Читаю список страниц…</p>
  }

  if (source.kind === 'incomplete') {
    return <p className="nav-tree__note">{source.reason}</p>
  }

  if (source.kind === 'unreadable') {
    return (
      <p className="nav-tree__issue">
        Список страниц прочитать не удалось ({source.reason}). Пустой список ниже{' '}
        <strong>не означает</strong>, что страниц нет.
      </p>
    )
  }

  return source.warning === null ? null : <p className="nav-tree__note">{source.warning}</p>
}

function NavDropZone(props: {
  readonly tree: readonly EditorNavItem[]
  readonly dragging: NavPath | null
  readonly parentPath: NavPath
  readonly index: number
  readonly onDrop: (parentPath: NavPath, index: number) => void
}): React.JSX.Element | null {
  const [over, setOver] = useState(false)

  if (props.dragging === null) {
    return null
  }

  const verdict = canDropNav(props.tree, props.dragging, props.parentPath)
  const allowed = verdict.kind === 'allow'

  return (
    <li
      className={`nav-tree__drop${over ? ' nav-tree__drop--over' : ''}${
        allowed ? '' : ' nav-tree__drop--refused'
      }`}
      data-testid="nav-drop"
      onDragOver={(event) => {
        if (!allowed) {
          return
        }

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
          props.onDrop(props.parentPath, props.index)
        }
      }}
    >
      {allowed ? null : <span className="nav-tree__drop-reason">{verdict.reason}</span>}
    </li>
  )
}

function NavItemCard(props: {
  readonly item: EditorNavItem
  readonly path: NavPath
  readonly issues: readonly { readonly path: string; readonly message: string }[]
  readonly options: readonly PageOption[]
  readonly first: boolean
  readonly last: boolean
  readonly dragging: NavPath | null
  readonly sourceReady: boolean
  readonly onDragStart: (path: NavPath) => void
  readonly onDragEnd: () => void
  readonly onField: (path: NavPath, name: string, value: unknown) => void
  readonly onMove: (path: NavPath, delta: number) => void
  readonly onRemove: (path: NavPath) => void
  readonly onAddChild: (path: NavPath) => void
  readonly renderList: (parentPath: NavPath, list: readonly EditorNavItem[]) => React.JSX.Element
}): React.JSX.Element {
  const here = pathKey(props.path)
  /** Адрес расхождения проверка пишет как `nav[0].children[1]`. */
  const issuePath = `nav${props.path.map((index, level) => (level === 0 ? `[${index}]` : `.children[${index}]`)).join('')}`
  const own = props.issues.filter((issue) => issue.path === issuePath)

  const children = Array.isArray(props.item.children) ? props.item.children : []
  const target = props.item.target
  const choice = describePageChoice(props.item.pageId, props.sourceReady ? props.options : null)

  return (
    <li className="nav-tree__item">
      <div className="nav-tree__row">
        <span
          className="nav-tree__grip"
          draggable
          role="button"
          tabIndex={-1}
          aria-label="Перетащить пункт"
          data-testid="nav-grip"
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', here)
            event.dataTransfer.effectAllowed = 'move'
            props.onDragStart(props.path)
          }}
          onDragEnd={props.onDragEnd}
        >
          ⠿
        </span>

        <input
          className="nav-tree__input"
          type="text"
          value={props.item.label}
          placeholder="Подпись в меню"
          aria-label="Подпись"
          onChange={(event) => {
            props.onField(props.path, 'label', event.target.value)
          }}
        />

        <select
          className="nav-tree__input nav-tree__input--narrow"
          value={target}
          aria-label="Назначение"
          onChange={(event) => {
            props.onField(props.path, 'target', event.target.value)
          }}
        >
          {NAV_TARGETS.map((value) => (
            <option key={value} value={value}>
              {NAV_TARGET_LABELS[value]}
            </option>
          ))}
        </select>

        <div className="nav-tree__controls">
          <button
            type="button"
            className="nav-tree__button"
            disabled={props.first}
            onClick={() => props.onMove(props.path, -1)}
            aria-label="Выше"
          >
            ↑
          </button>
          <button
            type="button"
            className="nav-tree__button"
            disabled={props.last}
            onClick={() => props.onMove(props.path, 1)}
            aria-label="Ниже"
          >
            ↓
          </button>
          <button
            type="button"
            className="nav-tree__button"
            onClick={() => props.onAddChild(props.path)}
          >
            Подпункт
          </button>
          <button
            type="button"
            className="nav-tree__button nav-tree__button--danger"
            onClick={() => props.onRemove(props.path)}
          >
            Удалить
          </button>
        </div>
      </div>

      {target === 'page' ? (
        <div className="nav-tree__row nav-tree__row--second">
          <select
            className="nav-tree__input"
            aria-label="Страница"
            value={choice.kind === 'resolved' ? choice.option.id : ''}
            disabled={!props.sourceReady}
            onChange={(event) => {
              props.onField(
                props.path,
                'pageId',
                event.target.value === '' ? null : event.target.value,
              )
            }}
          >
            <option value="">— страница не выбрана —</option>
            {props.options.map((option) => (
              <option key={option.id} value={option.id}>
                {describeOption(option)}
              </option>
            ))}
          </select>

          <label className="nav-tree__checkbox">
            <input
              type="checkbox"
              checked={props.item.openInNewTab === true}
              onChange={(event) => {
                props.onField(props.path, 'openInNewTab', event.target.checked)
              }}
            />
            в новой вкладке
          </label>
        </div>
      ) : null}

      {target === 'external' ? (
        <div className="nav-tree__row nav-tree__row--second">
          <input
            className="nav-tree__input"
            type="url"
            aria-label="Внешний адрес"
            value={typeof props.item.href === 'string' ? props.item.href : ''}
            placeholder="https://…"
            onChange={(event) => {
              props.onField(props.path, 'href', event.target.value)
            }}
          />
          <label className="nav-tree__checkbox">
            <input
              type="checkbox"
              checked={props.item.openInNewTab === true}
              onChange={(event) => {
                props.onField(props.path, 'openInNewTab', event.target.checked)
              }}
            />
            в новой вкладке
          </label>
        </div>
      ) : null}

      {choice.kind === 'unresolved' ? <p className="nav-tree__issue">{choice.note}</p> : null}
      {choice.kind === 'unknown' ? (
        <p className="nav-tree__note">Страница #{choice.id} — список ещё читается.</p>
      ) : null}
      {choice.kind === 'resolved' && choice.note !== null ? (
        <p className="nav-tree__note">{choice.note}</p>
      ) : null}

      {/*
       * Раскладка значима только у пункта с потомками: мега-меню без
       * содержимого — обещание панели, которой не будет (ADR-0033). Поэтому
       * выбор и показывается только там, где он что-то меняет.
       */}
      {children.length > 0 ? (
        <div className="nav-tree__row nav-tree__row--second">
          <label className="nav-tree__label" htmlFor={`${here}-layout`}>
            Раскрывается как
          </label>
          <select
            id={`${here}-layout`}
            className="nav-tree__input nav-tree__input--narrow"
            value={props.item.layout === 'mega' ? 'mega' : 'list'}
            onChange={(event) => {
              props.onField(props.path, 'layout', event.target.value)
            }}
          >
            {NAV_LAYOUTS.map((value) => (
              <option key={value} value={value}>
                {NAV_LAYOUT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {own.map((issue) => (
        <p key={issue.message} className="nav-tree__issue">
          {issue.message}
        </p>
      ))}

      {children.length > 0 || props.dragging !== null
        ? props.renderList(props.path, children)
        : null}
    </li>
  )
}

export default NavTreeField

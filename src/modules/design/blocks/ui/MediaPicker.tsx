'use client'

import { useEffect, useState } from 'react'

import {
  describeRow,
  describeSelection,
  emptySelectionFor,
  mediaByIdUrl,
  mediaDocsOf,
  mediaSearchUrl,
  toMediaRow,
} from './media-pick'

import type { MediaRow, MediaSelection } from './media-pick'

/**
 * Выбор файла из медиатеки в форме пропсов блока ([[DEBT-011]], ADR-0034).
 *
 * До этого идентификатор файла вводился строкой: редактор должен был открыть
 * медиатеку в соседней вкладке, найти файл, скопировать число. Опечатка в
 * числе давала блок без изображения — и ни одной ошибки нигде.
 *
 * Компонент тонкий. Все решения — что выбрано, пригоден ли файл, чем
 * отличается «не выбрано» от «выбран удалённый» — приняты в `media-pick.ts` и
 * проверены там же; здесь только запросы и разметка.
 */

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'include' })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

export function MediaPicker(props: {
  readonly id: string
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): React.JSX.Element {
  const [card, setCard] = useState<MediaRow | null | undefined>(undefined)
  const [failure, setFailure] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const value = typeof props.value === 'string' ? props.value.trim() : ''

  useEffect(() => {
    if (emptySelectionFor(value)) {
      setCard(undefined)
      setFailure(null)
      return
    }

    let alive = true

    void (async () => {
      try {
        const body = await getJson(mediaByIdUrl(value))

        if (!alive) {
          return
        }

        setFailure(null)
        setCard(
          body === null || typeof body !== 'object'
            ? null
            : toMediaRow(body as Record<string, unknown>),
        )
      } catch (error) {
        if (alive) {
          setCard(undefined)
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [value])

  const selection = describeSelection({ value, card, failure })

  return (
    <div className="media-pick" data-testid="media-pick">
      <SelectionView selection={selection} />

      <div className="media-pick__actions">
        <button
          type="button"
          className="block-tree__button"
          onClick={() => {
            setOpen(!open)
          }}
          aria-expanded={open}
        >
          {selection.kind === 'empty' ? 'Выбрать из медиатеки' : 'Заменить'}
        </button>

        {selection.kind === 'empty' ? null : (
          <button
            type="button"
            className="block-tree__button block-tree__button--danger"
            onClick={() => {
              props.onChange('')
            }}
          >
            Очистить
          </button>
        )}
      </div>

      {/*
       * Идентификатор остаётся видимым и правимым. Не рудимент: поле JSON
       * правили руками до появления конструктора, и отобрать у редактора
       * возможность вписать известный ему номер значило бы сделать часть
       * прежних страниц неремонтируемой через интерфейс.
       */}
      <input
        id={props.id}
        className="block-form__input media-pick__id"
        type="text"
        value={typeof props.value === 'string' ? props.value : ''}
        placeholder="Идентификатор файла из медиатеки"
        onChange={(event) => {
          props.onChange(event.target.value)
        }}
      />

      {open ? (
        <MediaSearch
          onCancel={() => {
            setOpen(false)
          }}
          onPick={(row) => {
            props.onChange(row.id)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function SelectionView({
  selection,
}: {
  readonly selection: MediaSelection
}): React.JSX.Element | null {
  switch (selection.kind) {
    case 'empty':
      return <p className="media-pick__note">Файл не выбран.</p>

    case 'loading':
      return <p className="media-pick__note">Читаю карточку файла #{selection.id}…</p>

    case 'unreadable':
    case 'unresolved':
      return <p className="block-form__issue">{selection.note}</p>

    case 'unusable':
      return (
        <div className="media-pick__card media-pick__card--bad">
          <Thumb row={selection.row} />
          <div>
            <span className="media-pick__title">{describeRow(selection.row)}</span>
            <p className="block-form__issue">{selection.note}</p>
          </div>
        </div>
      )

    case 'resolved':
      return (
        <div className="media-pick__card">
          <Thumb row={selection.row} />
          <span className="media-pick__title">{describeRow(selection.row)}</span>
        </div>
      )
  }
}

function Thumb({ row }: { readonly row: MediaRow }): React.JSX.Element {
  if (row.url === null) {
    return <span className="media-pick__thumb media-pick__thumb--none">нет файла</span>
  }

  /*
   * Обычный `img`, а не `next/image`: медиатека раздаётся с отдельного
   * origin (`MEDIA_PUBLIC_URL` обязан отличаться от адреса админки), и
   * оптимизатор пришлось бы открывать на произвольные адреса. Превью в
   * админке того не стоит.
   */
  return <img className="media-pick__thumb" src={row.url} alt={row.alt} />
}

function MediaSearch(props: {
  readonly onPick: (row: MediaRow) => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<readonly MediaRow[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const body = await getJson(mediaSearchUrl(query))

          if (alive) {
            setRows(mediaDocsOf(body))
            setFailure(null)
          }
        } catch (error) {
          if (alive) {
            setRows(null)
            setFailure(error instanceof Error ? error.message : String(error))
          }
        }
      })()
    }, 250)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="media-pick__browser">
      <input
        className="block-form__input"
        type="search"
        value={query}
        placeholder="Поиск по описанию файла"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />

      {failure === null ? null : (
        <p className="block-form__issue">
          Медиатека не ответила ({failure}). Это отказ, а не пустая медиатека.
        </p>
      )}

      {rows === null ? (
        failure === null ? (
          <p className="media-pick__note">Читаю медиатеку…</p>
        ) : null
      ) : rows.length === 0 ? (
        <p className="media-pick__note">
          Ничего не нашлось. Загрузите файл в медиатеку — отсюда загрузка не делается намеренно:
          карточка требует альтернативного текста, и заполнять его между делом не стоит.
        </p>
      ) : (
        <ul className="media-pick__list">
          {rows.map((row) => (
            <li key={row.id} className="media-pick__row">
              <Thumb row={row} />
              <span className="media-pick__title">{describeRow(row)}</span>
              <button
                type="button"
                className="block-tree__button"
                onClick={() => {
                  props.onPick(row)
                }}
              >
                Выбрать
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="block-tree__button" onClick={props.onCancel}>
        Закрыть
      </button>
    </div>
  )
}

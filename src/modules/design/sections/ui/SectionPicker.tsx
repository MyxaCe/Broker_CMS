'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import {
  chainTo,
  describeSectionChoice,
  sectionChoices,
  sectionRowsOf,
  sectionsUrl,
} from './section-options'

import type { SectionChoices, SectionRow, TenantLink } from './section-options'

/**
 * Выбор переиспользуемой секции по ключу ([[DEBT-011]], шестой пункт).
 *
 * До этого ключ вводился строкой. Опечатка в ключе — это `unknown-section`
 * при сборке релиза, то есть через неделю после правки страницы, и
 * обнаруживает её не тот, кто ошибся.
 *
 * Компонент тонкий: что можно выбрать, что сейчас стоит в поле и чем
 * «перекрыто» отличается от «нет такого» — решено в `section-options.ts` и
 * проверено там же. Здесь только запросы и разметка.
 *
 * `@/platform` отсюда не импортируется и импортироваться не может: клиентский
 * компонент с этой бочкой роняет **всю** админку в `500`, и этого не видит ни
 * один тест (ADR-0034). Барьер стоит линтером.
 */

const TENANTS_LIMIT = 200

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function tenantLinksOf(body: unknown): TenantLink[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  if (!Array.isArray(docs)) {
    return []
  }

  return docs.flatMap((doc) => {
    if (doc === null || typeof doc !== 'object') {
      return []
    }

    const record = doc as Record<string, unknown>
    const parent = record.parent

    return [
      {
        id: String(record.id),
        name: typeof record.name === 'string' ? record.name : String(record.id),
        parentId:
          parent === null || parent === undefined
            ? null
            : typeof parent === 'object' && 'id' in parent
              ? String((parent as { id: unknown }).id)
              : String(parent),
      },
    ]
  })
}

/**
 * Три состояния списка, и третье обязательно.
 *
 * «Не прочитали» и «прочитали, пусто» — разное, а «не смогли прочитать» —
 * третье: недоступное API не является доказательством, что секций нет.
 */
type Source =
  | { readonly kind: 'loading' }
  | { readonly kind: 'incomplete'; readonly reason: string }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'ready'; readonly choices: SectionChoices }

export function SectionPicker(props: {
  readonly id: string
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): React.JSX.Element {
  /**
   * Владелец и язык берутся из состояния формы: страницу правят до
   * сохранения, и ждать сохранения, чтобы предложить секции, нельзя.
   *
   * У страницы владелец лежит в `site`, у секции и глобальной области — в
   * `owner`. Поле одно по смыслу и разное по имени, поэтому читаются оба.
   */
  const context = useFormFields(([fields]) => {
    const owner = fields?.site?.value ?? fields?.owner?.value
    const locale = fields?.locale?.value

    return `${String(owner ?? '')}\u0000${String(locale ?? '')}`
  })

  const [ownerId = '', locale = ''] = context.split('\u0000')
  const [loaded, setLoaded] = useState<Source | null>(null)

  /**
   * Нехватка контекста видна **сразу**, а не после первого эффекта.
   *
   * При первом рендере эффекты ещё не выполнялись, и «читаем список секций»
   * было бы в этот момент неправдой: читать нечего и не начинали. Подпись
   * обязана гореть от того, что она называет.
   */
  const incomplete = ownerId === '' || locale === ''

  const source: Source = incomplete
    ? {
        kind: 'incomplete',
        reason:
          'Выберите владельца и язык — набор секций зависит от обоих, и без них предлагать нечего.',
      }
    : (loaded ?? { kind: 'loading' })

  useEffect(() => {
    if (ownerId === '' || locale === '') {
      setLoaded(null)

      return
    }

    let alive = true

    void (async () => {
      try {
        const [sections, tenants] = await Promise.all([
          getJson(sectionsUrl(locale)),
          getJson(`/api/tenants?limit=${TENANTS_LIMIT}&depth=0`),
        ])

        if (!alive) {
          return
        }

        const rows: SectionRow[] = sectionRowsOf(sections)
        const links = tenantLinksOf(tenants)

        setLoaded({
          kind: 'ready',
          choices: sectionChoices({
            rows,
            tenants: links,
            chainIds: chainTo(links, ownerId),
            locale,
          }),
        })
      } catch (error) {
        if (alive) {
          setLoaded({
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
   * Пока список не прочитан, в `describeSectionChoice` уходит `null` — и
   * заполненный ключ показывается как «читаем», а не как «такого нет».
   * Непрочитанное, выданное за отсутствующее, уже стирало живые ссылки в
   * редакторе меню.
   */
  const choice = describeSectionChoice(props.value, source.kind === 'ready' ? source.choices : null)

  const value = typeof props.value === 'string' ? props.value : ''

  return (
    <div className="section-pick" data-testid="section-pick">
      <select
        id={props.id}
        className="block-form__input"
        value={source.kind === 'ready' && choice.kind === 'resolved' ? value : ''}
        disabled={source.kind !== 'ready'}
        onChange={(event) => {
          props.onChange(event.target.value)
        }}
      >
        <option value="">— секция не выбрана —</option>
        {source.kind === 'ready'
          ? source.choices.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.provenance === 'own'
                  ? `${option.title} · ${option.key}`
                  : `${option.title} · ${option.key} · от «${option.ownerName}»`}
              </option>
            ))
          : null}
      </select>

      {source.kind === 'loading' ? <p className="block-form__help">Читаем список секций…</p> : null}
      {source.kind === 'incomplete' ? <p className="block-form__help">{source.reason}</p> : null}
      {source.kind === 'unreadable' ? (
        <p className="block-form__issue">
          Список секций прочитать не удалось ({source.reason}). Это отказ, а не отсутствие секций —
          не меняйте ключ, пока не проверите.
        </p>
      ) : null}

      {/*
       * Ключ, который стоит в поле и не попал в список, показывается
       * отдельно: выпадающий список сам по себе выглядел бы как «ничего не
       * выбрано», и редактор решил бы, что ссылки нет.
       */}
      {choice.kind === 'unresolved' || choice.kind === 'shadowed' ? (
        <p className="block-form__issue">
          Сейчас в поле «{choice.key}». {choice.note}
        </p>
      ) : null}

      {choice.kind === 'loading' ? (
        <p className="block-form__help">Сейчас в поле «{choice.key}» — проверяем.</p>
      ) : null}

      {choice.kind === 'resolved' && choice.note !== null ? (
        <p className="block-form__help">{choice.note}</p>
      ) : null}

      {source.kind === 'ready' && source.choices.options.length === 0 ? (
        <p className="block-form__help">
          Доступных секций на этом языке нет. Их заводят в коллекции «Секции» — у бренда, региона
          или самого сайта.
        </p>
      ) : null}
    </div>
  )
}

'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import { chainFromTenantDoc, tokenSetFromDocs } from '../from-docs'
import { buildPalettePreview, PREVIEW_THEMES } from '../preview'
import { PRIMITIVE_CATEGORIES, ROLE_GROUPS } from '../types'

import './palette-preview.css'

import type { PalettePreview as Preview, TokenDraft } from '../preview'
import type { PrimitiveCategory, RoleGroup, TokenSet } from '../types'

/**
 * Живой предпросмотр палитры при правке токена (ТЗ 2.1, [[DEBT-011]]).
 *
 * Отвечает на вопрос, на который до этого нельзя было ответить, не сохранив:
 * **что изменится, если поменять вот это значение**. Трёхуровневый граф для
 * того и сделан, чтобы правка одного примитива меняла кнопки, ссылки и
 * акценты разом; увидеть этот эффект было негде.
 *
 * Компонент тонкий: набор собирается и разрешается теми же функциями, что и
 * релиз (`tokenSetFromDocs`, `buildPalettePreview` → `resolveTokens`).
 */

const EMPTY: TokenSet = { primitives: [], roles: [], components: [] }

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function docsOf(body: unknown): unknown[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  return Array.isArray(docs) ? docs : []
}

function field(fields: Record<string, { value: unknown }>, name: string): string {
  const value = fields[name]?.value

  return typeof value === 'string' ? value.trim() : value === undefined ? '' : String(value)
}

/**
 * Черновик из состояния формы.
 *
 * Токен без имени черновиком не считается: безымянная запись не перекрывает
 * ничего и в предпросмотре выглядела бы как токен с пустым именем — то есть
 * как расхождение, которого редактор не создавал.
 */
export function draftFromFields(
  level: TokenDraft['level'],
  fields: Record<string, { value: unknown }>,
): TokenDraft | null {
  const name = field(fields, 'name')

  if (name === '') {
    return null
  }

  if (level === 'primitive') {
    const category = field(fields, 'category')

    return {
      level,
      value: {
        name,
        /**
         * Умолчание `color` названо и несимметрично: незаполненная категория
         * означает, что токен ещё не отнесли никуда, а в палитре показывать
         * имеет смысл именно цвет. Ошибиться в сторону показа безопаснее.
         */
        category: isPrimitiveCategory(category) ? category : 'color',
        value: field(fields, 'value'),
      },
    }
  }

  if (level === 'role') {
    const group = field(fields, 'group')

    return {
      level,
      value: {
        name,
        group: isRoleGroup(group) ? group : 'surface',
        light: field(fields, 'light'),
        dark: field(fields, 'dark'),
      },
    }
  }

  return {
    level,
    value: {
      name,
      source: field(fields, 'source') === 'primitive' ? 'primitive' : 'role',
      reference: field(fields, 'reference'),
    },
  }
}

function isPrimitiveCategory(value: string): value is PrimitiveCategory {
  return (PRIMITIVE_CATEGORIES as readonly string[]).includes(value)
}

function isRoleGroup(value: string): value is RoleGroup {
  return (ROLE_GROUPS as readonly string[]).includes(value)
}

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-owner' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'ready'; readonly set: TokenSet; readonly chain: readonly string[] }

function PalettePreviewBody({ level }: { readonly level: TokenDraft['level'] }): React.JSX.Element {
  /**
   * Снимок полей формы строкой: `useFormFields` пересчитывает подписчика на
   * каждое нажатие клавиши, и возвращать отсюда новый объект означало бы
   * перерисовывать предпросмотр бесконечно.
   */
  const snapshot = useFormFields(([fields]) => {
    const wanted = [
      'name',
      'category',
      'value',
      'group',
      'light',
      'dark',
      'source',
      'reference',
      'owner',
    ]

    return wanted.map((key) => `${key}=${String(fields?.[key]?.value ?? '')}`).join('\u0000')
  })

  const fields = useMemo(() => {
    const parsed: Record<string, { value: unknown }> = {}

    for (const entry of snapshot.split('\u0000')) {
      const at = entry.indexOf('=')
      parsed[entry.slice(0, at)] = { value: entry.slice(at + 1) }
    }

    return parsed
  }, [snapshot])

  const owner = field(fields, 'owner')
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })

  useEffect(() => {
    if (owner === '') {
      setLoaded({ kind: 'no-owner' })
      return
    }

    let alive = true

    void (async () => {
      try {
        const tenant = await getJson(`/api/tenants/${encodeURIComponent(owner)}?depth=3`)
        const chain = chainFromTenantDoc(tenant)
        const where = chain
          .map((id, index) => `where[owner][in][${index}]=${encodeURIComponent(id)}`)
          .join('&')

        const [primitives, roles, components] = await Promise.all([
          getJson(`/api/design-primitives?limit=0&depth=0&${where}`),
          getJson(`/api/design-roles?limit=0&depth=0&${where}`),
          getJson(`/api/design-component-tokens?limit=0&depth=0&${where}`),
        ])

        if (!alive) {
          return
        }

        setLoaded({
          kind: 'ready',
          chain,
          set: tokenSetFromDocs(chain, {
            primitives: docsOf(primitives),
            roles: docsOf(roles),
            components: docsOf(components),
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
  }, [owner])

  const draft = useMemo(() => draftFromFields(level, fields), [level, fields])

  const preview = useMemo(
    () =>
      buildPalettePreview({
        saved: loaded.kind === 'ready' ? loaded.set : EMPTY,
        draft,
      }),
    [loaded, draft],
  )

  /**
   * Отсутствие владельца читается из формы напрямую, а не ожидается от
   * эффекта. Иначе предпросмотр сначала показывает «читаю», а потом
   * «владельца нет» — то есть сообщает о работе, которой не было.
   */
  if (owner === '') {
    return (
      <p className="palette__note">
        Выберите владельца — палитра складывается из наборов бренда, региона и сайта, и без
        владельца показывать нечего.
      </p>
    )
  }

  if (loaded.kind === 'loading' || loaded.kind === 'no-owner') {
    return <p className="palette__note">Читаю палитру владельца…</p>
  }

  if (loaded.kind === 'unreadable') {
    return (
      <p className="palette__note palette__note--alarm">
        Палитру владельца прочитать не удалось ({loaded.reason}). Пустой предпросмотр ниже{' '}
        <strong>не означает</strong>, что палитра пуста.
      </p>
    )
  }

  return <PaletteView preview={preview} chainLength={loaded.chain.length} />
}

function PaletteView({
  preview,
  chainLength,
}: {
  readonly preview: Preview
  readonly chainLength: number
}): React.JSX.Element {
  return (
    <div className="palette" data-testid="palette-preview">
      <p className="palette__note">
        Палитра по цепочке владельца ({chainLength} узл{chainLength === 1 ? 'а' : 'ов'}):{' '}
        {preview.swatches.length} цветовых токенов.{' '}
        {preview.affected === 0
          ? 'Текущая правка ни одного значения не меняет.'
          : `Текущая правка меняет значений: ${preview.affected}.`}
      </p>

      {preview.broken.length === 0 ? null : (
        <div className="palette__alarm" data-testid="palette-broken">
          <strong>Эта правка опускает ниже AA пар: {preview.broken.length}.</strong>
          <ul>
            {preview.broken.map((row) => (
              <li key={row.label}>
                {row.label} — {row.ratio.toFixed(2)}:1 при требуемых {row.required}:1
              </li>
            ))}
          </ul>
          <span>Релиз с таким контрастом не соберётся.</span>
        </div>
      )}

      {preview.issues.length === 0 ? null : (
        <ul className="palette__issues">
          {preview.issues.map((issue) => (
            <li key={`${issue.code}-${issue.name}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      {PREVIEW_THEMES.map((theme) => (
        <section key={theme} className="palette__theme" data-theme={theme}>
          <h5 className="palette__theme-title">
            {theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}
          </h5>

          <div className="palette__grid">
            {preview.swatches.map((swatch) => {
              const value = theme === 'light' ? swatch.light : swatch.dark

              return (
                <div
                  key={`${theme}-${swatch.name}`}
                  className={`palette__swatch${swatch.changed ? ' palette__swatch--changed' : ''}${
                    swatch.edited ? ' palette__swatch--edited' : ''
                  }`}
                >
                  <span
                    className="palette__chip"
                    style={value === null ? undefined : { background: value }}
                  >
                    {value === null ? '—' : ''}
                  </span>
                  <span className="palette__name">{swatch.name}</span>
                  <span className="palette__value">{value ?? 'не разрешается'}</span>
                </div>
              )
            })}
          </div>

          {/*
           * Типовые компоненты (ТЗ 2.1): кнопка, карточка, текст и ссылка на
           * тех же разрешённых значениях. Палитра квадратиками не отвечает на
           * вопрос «читается ли это» — а именно он и важен.
           */}
          <Sampler values={preview.byTheme[theme]} />
        </section>
      ))}

      <table className="palette__contrast">
        <tbody>
          {preview.contrast.map((row) => (
            <tr key={row.label} className={row.passes ? undefined : 'palette__contrast-row--bad'}>
              <td>{row.label}</td>
              <td>
                {row.ratio.toFixed(2)}:1 / {row.required}:1
              </td>
              <td>{row.passes ? 'AA' : 'ниже AA'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Sampler({
  values,
}: {
  readonly values: Readonly<Record<string, string>>
}): React.JSX.Element {
  const color = (name: string, fallback: string): string => values[name] ?? fallback

  return (
    <div
      className="palette__sampler"
      style={{
        background: color('surface.base', 'transparent'),
        color: color('text.primary', 'inherit'),
        borderColor: color('border.default', 'currentColor'),
      }}
    >
      <span className="palette__sampler-text">Торговля CFD сопряжена с риском</span>
      <a
        className="palette__sampler-link"
        style={{ color: color('text.link', 'inherit') }}
        href="#"
      >
        подробнее
      </a>
      <span
        className="palette__sampler-button"
        style={{
          background: color('button.primary.bg', color('accent.default', 'transparent')),
          color: color('text.inverse', 'inherit'),
        }}
      >
        Открыть счёт
      </span>
      <span className="palette__sampler-market">
        <span style={{ color: color('market.up', 'inherit') }}>▲ 1.0842</span>
        <span style={{ color: color('market.down', 'inherit') }}>▼ 1.0831</span>
      </span>
    </div>
  )
}

export function PrimitivePalettePreview(): React.JSX.Element {
  return <PalettePreviewBody level="primitive" />
}

export function RolePalettePreview(): React.JSX.Element {
  return <PalettePreviewBody level="role" />
}

export function ComponentPalettePreview(): React.JSX.Element {
  return <PalettePreviewBody level="component" />
}

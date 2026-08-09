import { cssVariableName, sanitizeCssValue } from '../tokens/export'

import { BlockView } from './BlockView'

import type { SnapshotGlobalArea, SnapshotNavigation } from '../structure/types'
import type { ResolvedNavItem } from '../navigation/tree'

/**
 * Оболочка страницы в предпросмотре (ТЗ 5.4).
 *
 * Показывает страницу **в её окружении**: с шапкой, меню, подвалом и полосой
 * риск-предупреждения. Без окружения предпросмотр обманывает: страница без
 * обязательной полосы выглядит законченной, а публикуется — нарушением.
 */

export interface PreviewPage {
  readonly title: string
  readonly path: string
  readonly locale: string
  readonly status: string
  readonly blocks: unknown
}

export interface PageViewProps {
  readonly page: PreviewPage
  readonly navigation: readonly SnapshotNavigation[]
  readonly areas: readonly SnapshotGlobalArea[]
  /** Разрешённые токены темы: имя → значение. */
  readonly tokens: Readonly<Record<string, string>>
}

export function PageView(props: PageViewProps): React.JSX.Element {
  const area = (kind: string): SnapshotGlobalArea | undefined =>
    props.areas.find((item) => item.kind === kind)

  const riskWarning = area('risk-warning')

  return (
    <div className="pv-page" style={themeVariables(props.tokens)}>
      {/*
       * Полоса риска стоит первой и вне обычного потока блоков. Так же она
       * стоит и в модели (ADR-0025): её проверяет движок, а не редактор.
       */}
      {riskWarning?.riskWarning === null || riskWarning?.riskWarning === undefined ? null : (
        <aside className="pv-risk">
          {riskWarning.riskWarning.text}
          {riskWarning.riskWarning.lossPercentage === null
            ? ''
            : ` ${riskWarning.riskWarning.lossPercentage}% счетов розничных инвесторов теряют деньги.`}
        </aside>
      )}

      <AreaView area={area('announcement')} className="pv-announcement" />

      <header className="pv-header">
        <AreaView area={area('header')} />
        <NavView menus={props.navigation} />
      </header>

      <main className="pv-main">
        <BlockList blocks={props.page.blocks} />
      </main>

      <footer className="pv-footer">
        <AreaView area={area('footer')} />
      </footer>

      <AreaView area={area('cookie-banner')} className="pv-cookie" />
    </div>
  )
}

function BlockList({ blocks }: { readonly blocks: unknown }): React.JSX.Element {
  const list = Array.isArray(blocks) ? blocks : []

  if (list.length === 0) {
    return <p className="pv-empty">На странице пока нет блоков.</p>
  }

  return (
    <>
      {list.map((node, index) => (
        <BlockView key={index} node={node} />
      ))}
    </>
  )
}

function AreaView({
  area,
  className,
}: {
  readonly area: SnapshotGlobalArea | undefined
  readonly className?: string
}): React.JSX.Element | null {
  const blocks = Array.isArray(area?.blocks) ? area.blocks : []

  if (blocks.length === 0) {
    return null
  }

  return (
    <div className={className}>
      {blocks.map((node, index) => (
        <BlockView key={index} node={node} />
      ))}
    </div>
  )
}

function NavView({ menus }: { readonly menus: readonly SnapshotNavigation[] }): React.JSX.Element {
  const primary = menus.find((menu) => menu.placement === 'primary')

  return (
    <nav className="pv-nav">
      <NavItems items={primary?.items ?? []} />
    </nav>
  )
}

function NavItems({ items }: { readonly items: readonly ResolvedNavItem[] }): React.JSX.Element {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          {item.url === null ? <span>{item.label}</span> : <a href={item.url}>{item.label}</a>}
          {item.children.length === 0 ? null : <NavItems items={item.children} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * Токены темы — переменными CSS на корне предпросмотра.
 *
 * Тем же способом, что и экспорт токенов для витрины (`toCssCustomProperties`):
 * предпросмотр обязан выглядеть так же, как сайт, а не «примерно так же».
 */
function themeVariables(tokens: Readonly<Record<string, string>>): React.CSSProperties {
  const style: Record<string, string> = {}

  for (const [name, value] of Object.entries(tokens)) {
    /**
     * Имя и значение проходят через те же функции, что и экспорт токенов для
     * витрины: вторая реализация разошлась бы с первой, и предпросмотр начал
     * бы отличаться от сайта именно в мелочах, которые никто не проверяет.
     */
    style[cssVariableName(name)] = sanitizeCssValue(value)
  }

  return style as React.CSSProperties
}

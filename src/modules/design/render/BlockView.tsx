import { findBlock } from '../blocks/registry'
import { cssVariableName } from '../tokens/export'

import type { CSSProperties } from 'react'

/**
 * Эталонная отрисовка блоков (ТЗ 5.4).
 *
 * Это **не витрина**. Витрина — отдельное приложение, живущее рядом (ТЗ,
 * вводная часть), и переписывать её здесь незачем. Здесь ровно то, без чего
 * предпросмотр невозможен: честное изображение того, что означает каждый тип
 * блока и каждый его проп.
 *
 * У рендерера две задачи, и вторая важнее первой:
 *
 *  · показать редактору страницу до публикации;
 *  · служить **образцом контракта** команде сайта. Описание типа словами
 *    расходится с кодом; работающий пример — нет.
 *
 * Поэтому оформление здесь намеренно скупое: цвета и отступы берутся из
 * токенов сайта, а вёрстка сведена к минимуму, за которым виден смысл блока.
 * Красивая вёрстка в предпросмотре обещала бы то, чего мы не поставляем.
 */

export interface BlockViewProps {
  readonly node: unknown
  readonly depth?: number
}

export function BlockView({ node, depth = 0 }: BlockViewProps): React.JSX.Element | null {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return null
  }

  const block = node as Record<string, unknown>
  const type = typeof block.type === 'string' ? block.type : ''
  const definition = findBlock(type)
  const props = (block.props ?? {}) as Record<string, unknown>

  if (definition === undefined) {
    /**
     * Неизвестный тип показывается заглушкой, а не пропускается: пропуск
     * выглядел бы как «блока нет», и редактор искал бы его в дереве.
     */
    return (
      <section className="pv-block pv-unknown" data-type={type}>
        Неизвестный тип блока «{type}»
      </section>
    )
  }

  return (
    <section className="pv-block" data-type={type} style={styleOf(block)}>
      <BlockBody type={type} props={props} block={block} depth={depth} />
    </section>
  )
}

function BlockBody({
  type,
  props,
  block,
  depth,
}: {
  readonly type: string
  readonly props: Record<string, unknown>
  readonly block: Record<string, unknown>
  readonly depth: number
}): React.JSX.Element {
  switch (type) {
    case 'hero':
      return (
        <div className="pv-hero">
          <h1>{text(props.title)}</h1>
          {text(props.subtitle) === '' ? null : <p className="pv-lead">{text(props.subtitle)}</p>}
          <Media value={props.image} />
          <Actions props={props} />
        </div>
      )

    case 'heading-text':
      return (
        <div>
          <Heading level={text(props.level)}>{text(props.title)}</Heading>
          <Paragraphs value={props.text} />
        </div>
      )

    case 'rich-text':
      return <Paragraphs value={props.body} />

    case 'quote':
      return (
        <blockquote className="pv-quote">
          <p>{text(props.text)}</p>
          {text(props.author) === '' ? null : (
            <footer>
              {text(props.author)}
              {text(props.role) === '' ? '' : `, ${text(props.role)}`}
            </footer>
          )}
        </blockquote>
      )

    case 'faq':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <dl className="pv-faq">
            {items(props.items).map((item, index) => (
              <div key={index}>
                <dt>{text(item.question)}</dt>
                <dd>{text(item.answer)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )

    case 'benefit-stack':
    case 'account-steps':
    case 'timeline':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <ol className="pv-grid">
            {items(props.items).map((item, index) => (
              <li key={index}>
                <strong>{text(item.title) || text(item.date)}</strong>
                <span>{text(item.text)}</span>
              </li>
            ))}
          </ol>
        </div>
      )

    case 'metrics':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <ul className="pv-grid">
            {items(props.items).map((item, index) => (
              <li key={index}>
                <strong className="pv-metric">{text(item.value)}</strong>
                <span>{text(item.caption)}</span>
                {/*
                 * Сноска к цифре показывается всегда и рядом с цифрой:
                 * оговорка, спрятанная в подвал, для регулятора не существует.
                 */}
                {text(item.note) === '' ? null : (
                  <small className="pv-note">{text(item.note)}</small>
                )}
              </li>
            ))}
          </ul>
        </div>
      )

    case 'testimonials':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <ul className="pv-grid">
            {items(props.items).map((item, index) => (
              <li key={index}>
                <p>{text(item.quote)}</p>
                <small>
                  {text(item.author)}
                  {text(item.role) === '' ? '' : `, ${text(item.role)}`}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )

    case 'cta-bar':
      return (
        <div className="pv-cta">
          <Heading level="h2">{text(props.title)}</Heading>
          <Paragraphs value={props.text} />
          <Actions props={props} />
        </div>
      )

    case 'split-feature':
      return (
        <div className={`pv-split pv-split--${text(props.mediaSide) || 'left'}`}>
          <Media value={props.image} />
          <div>
            <Heading level="h2">{text(props.title)}</Heading>
            <Paragraphs value={props.body} />
            <Actions props={props} />
          </div>
        </div>
      )

    case 'image':
      return (
        <figure className="pv-figure">
          <Media value={props.image} />
          {items(props.items).map((item, index) => (
            <Media key={index} value={item.image} />
          ))}
          {text(props.caption) === '' ? null : <figcaption>{text(props.caption)}</figcaption>}
        </figure>
      )

    case 'partner-logos':
    case 'downloads':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <ul className="pv-inline">
            {items(props.items).map((item, index) => (
              <li key={index}>{text(item.name) || text(item.label)}</li>
            ))}
          </ul>
        </div>
      )

    case 'account-types':
    case 'pricing-grid':
      return (
        <div>
          <Heading level="h2">{text(props.title)}</Heading>
          <ul className="pv-grid">
            {items(props.items).map((item, index) => (
              <li key={index}>
                <strong>{text(item.name)}</strong>
                <span>{text(item.price) || text(item.minDeposit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )

    case 'comparison-table':
    case 'table':
      return <TableView props={props} />

    case 'tabs':
      return (
        <div>
          <ul className="pv-inline">
            {items(props.items).map((item, index) => (
              <li key={index}>{text(item.label)}</li>
            ))}
          </ul>
          <Slots block={block} depth={depth} />
        </div>
      )

    case 'columns':
      return <Slots block={block} depth={depth} columns />

    case 'divider':
      return <hr className="pv-divider" />

    case 'spacer':
      return <div className="pv-spacer" data-size={text(props.size) || 'm'} />

    case 'anchor':
      return <span id={text(props.id)} className="pv-anchor" />

    case 'video-embed':
      return (
        <figure className="pv-figure">
          <div className="pv-placeholder">Видео: {text(props.url)}</div>
          {text(props.caption) === '' ? null : <figcaption>{text(props.caption)}</figcaption>}
        </figure>
      )

    case 'form':
    case 'newsletter':
      return (
        <div className="pv-form">
          <Heading level="h2">{text(props.title)}</Heading>
          <Paragraphs value={props.text} />
          <div className="pv-placeholder">{text(props.submitLabel) || 'Отправить'}</div>
          {/*
           * Текст согласия показывается в предпросмотре наравне с формой:
           * форма без него собирает персональные данные без основания, и это
           * должно быть видно до публикации, а не после.
           */}
          <small className="pv-note">{text(props.consentText)}</small>
        </div>
      )

    case 'raw-embed':
      /**
       * Произвольная разметка **не исполняется** даже в предпросмотре: иначе
       * предпросмотр стал бы способом выполнить чужой скрипт в админке, где
       * открыта сессия редактора.
       */
      return <pre className="pv-raw">{text(props.html)}</pre>

    default:
      /**
       * Динамические блоки и всё, что рисуется данными извне. В предпросмотре
       * показывается их место и запрос — подставлять выдуманные данные нельзя:
       * редактор принял бы их за настоящие.
       */
      return <DataPlaceholder type={type} props={props} block={block} />
  }
}

function DataPlaceholder({
  type,
  props,
  block,
}: {
  readonly type: string
  readonly props: Record<string, unknown>
  readonly block: Record<string, unknown>
}): React.JSX.Element {
  const definition = findBlock(type)
  const source = (block.dataSource ?? {}) as Record<string, unknown>

  return (
    <div className="pv-placeholder">
      <strong>{definition?.title ?? type}</strong>
      {text(props.title) === '' ? null : <span> — {text(props.title)}</span>}
      {definition?.boundTo === undefined ? null : (
        <small className="pv-note">
          Данные из «{definition.boundTo}»
          {typeof source.limit === 'number' ? `, ${source.limit} записей` : ''}. В предпросмотре не
          подставляются: выдуманные записи редактор принял бы за настоящие.
        </small>
      )}
    </div>
  )
}

function Slots({
  block,
  depth,
  columns = false,
}: {
  readonly block: Record<string, unknown>
  readonly depth: number
  readonly columns?: boolean
}): React.JSX.Element | null {
  const slots = block.slots

  if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) {
    return null
  }

  return (
    <>
      {Object.entries(slots as Record<string, unknown>).map(([slot, children]) => (
        <div key={slot} className={columns ? 'pv-columns' : undefined} data-slot={slot}>
          {(Array.isArray(children) ? children : []).map((child, index) => (
            <BlockView key={index} node={child} depth={depth + 1} />
          ))}
        </div>
      ))}
    </>
  )
}

function TableView({ props }: { readonly props: Record<string, unknown> }): React.JSX.Element {
  const columns = items(props.columns)
  const rows = items(props.rows)

  return (
    <div>
      <Heading level="h2">{text(props.title)}</Heading>
      <table className="pv-table">
        <thead>
          <tr>
            {columns.length === 0 ? <th /> : null}
            {columns.map((column, index) => (
              <th key={index}>{text(column.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {text(row.label) === '' ? null : <th scope="row">{text(row.label)}</th>}
              {splitCells(row.values ?? row.cells).map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Actions({ props }: { readonly props: Record<string, unknown> }): React.JSX.Element | null {
  const primary = text(props.ctaLabel)
  const secondary = text(props.secondaryLabel)

  if (primary === '' && secondary === '') {
    return null
  }

  return (
    <p className="pv-actions">
      {primary === '' ? null : <span className="pv-button">{primary}</span>}
      {secondary === '' ? null : <span className="pv-button pv-button--ghost">{secondary}</span>}
    </p>
  )
}

function Media({ value }: { readonly value: unknown }): React.JSX.Element | null {
  const id = text(value)

  if (id === '') {
    return null
  }

  /**
   * Изображение показывается заглушкой с идентификатором, а не тегом `img`:
   * адрес файла известен серверу, а не дереву блоков, и подставлять сюда
   * догадку значило бы показать редактору битую картинку вместо честного
   * «здесь будет файл такой-то».
   */
  return <div className="pv-media">Изображение #{id}</div>
}

function Heading({
  level,
  children,
}: {
  readonly level?: string
  readonly children: React.ReactNode
}): React.JSX.Element | null {
  if (children === '' || children === null || children === undefined) {
    return null
  }

  if (level === 'h3') return <h3>{children}</h3>
  if (level === 'h4') return <h4>{children}</h4>

  return <h2>{children}</h2>
}

/**
 * Абзацы из простого текста: пустая строка разделяет абзацы.
 *
 * Форматированный текст пока показывается так же. Разбор разметки редактора —
 * отдельная работа, и делать её наполовину хуже, чем показать текст как есть:
 * полуразобранная разметка выглядит как испорченный текст.
 */
function Paragraphs({ value }: { readonly value: unknown }): React.JSX.Element | null {
  const body = text(value)

  if (body === '') {
    return null
  }

  return (
    <>
      {body.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </>
  )
}

function styleOf(block: Record<string, unknown>): CSSProperties {
  const style = (block.style ?? {}) as Record<string, unknown>
  const background = typeof style.background === 'string' ? style.background : ''

  const result: Record<string, string> = {}

  if (background !== '') {
    result.background = `var(${cssVariableName(background)})`
  }

  return result as CSSProperties
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function items(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? [entry as Record<string, unknown>]
      : [],
  )
}

/** Ячейки строки заданы одной строкой через точку с запятой — так их правит редактор. */
function splitCells(value: unknown): string[] {
  const raw = text(value)

  return raw === '' ? [] : raw.split(';').map((cell) => cell.trim())
}

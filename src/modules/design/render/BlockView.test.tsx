import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BlockView } from './BlockView'

/**
 * Проверка эталонного рендерера строкой разметки.
 *
 * Без браузера и без библиотеки тестирования компонентов: именно эта строка
 * уезжает в предпросмотр, и проверять её напрямую честнее, чем через слой,
 * который её пересобирает.
 */
function render(node: unknown): string {
  return renderToStaticMarkup(<BlockView node={node} />)
}

describe('содержимое блока попадает в разметку', () => {
  it('герой показывает заголовок и подзаголовок', () => {
    const html = render({
      type: 'hero',
      props: { title: 'Торгуйте с Apex', subtitle: 'С 2011 года', ctaLabel: 'Открыть счёт' },
    })

    expect(html).toContain('Торгуйте с Apex')
    expect(html).toContain('С 2011 года')
    expect(html).toContain('Открыть счёт')
  })

  it('пустой подзаголовок не даёт пустого абзаца', () => {
    expect(render({ type: 'hero', props: { title: 'Заголовок', subtitle: '' } })).not.toContain(
      '<p class="pv-lead">',
    )
  })

  it('FAQ разворачивается в список вопросов', () => {
    const html = render({
      type: 'faq',
      props: {
        title: 'Вопросы',
        items: [{ question: 'Как открыть счёт?', answer: 'Заполнить анкету.' }],
      },
    })

    expect(html).toContain('Как открыть счёт?')
    expect(html).toContain('Заполнить анкету.')
  })

  it('пустая строка разделяет абзацы', () => {
    const html = render({ type: 'rich-text', props: { body: 'Первый.\n\nВторой.' } })

    expect(html).toContain('<p>Первый.</p>')
    expect(html).toContain('<p>Второй.</p>')
  })

  it('таблица разбирает ячейки, заданные через точку с запятой', () => {
    const html = render({
      type: 'table',
      props: { columns: [{ label: 'Пара' }, { label: 'Спред' }], rows: [{ cells: 'EURUSD; 0.1' }] },
    })

    expect(html).toContain('<td>EURUSD</td>')
    expect(html).toContain('<td>0.1</td>')
  })
})

describe('вложенность', () => {
  it('колонки отрисовывают вложенные блоки', () => {
    const html = render({
      type: 'columns',
      slots: { columns: [{ type: 'quote', props: { text: 'Вложенная цитата' } }] },
    })

    expect(html).toContain('Вложенная цитата')
    expect(html).toContain('data-slot="columns"')
  })
})

describe('честность предпросмотра', () => {
  /** Выдуманные записи редактор принял бы за настоящие. */
  it('динамический блок показывает место и запрос, а не данные', () => {
    const html = render({
      type: 'news-feed',
      props: { title: 'Новости' },
      dataSource: { collection: 'articles', limit: 6 },
    })

    expect(html).toContain('Лента новостей')
    expect(html).toContain('Данные из «articles»')
    expect(html).toContain('6 записей')
  })

  /**
   * Предпросмотр не должен становиться способом выполнить чужой скрипт в
   * админке, где открыта сессия редактора.
   */
  it('произвольная разметка не исполняется, а показывается текстом', () => {
    const html = render({ type: 'raw-embed', props: { html: '<script>alert(1)</script>' } })

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('изображение показывается заглушкой с идентификатором, а не битым тегом', () => {
    const html = render({ type: 'image', props: { image: '42' } })

    expect(html).toContain('Изображение #42')
    expect(html).not.toContain('<img')
  })

  /** Пропуск выглядел бы как «блока нет», и редактор искал бы его в дереве. */
  it('неизвестный тип показывается заглушкой, а не пропускается', () => {
    const html = render({ type: 'выдумка' })

    expect(html).toContain('Неизвестный тип блока')
  })

  /** Оговорка, спрятанная в подвал, для регулятора не существует. */
  it('сноска к цифре стоит рядом с цифрой', () => {
    const html = render({
      type: 'metrics',
      props: { items: [{ value: '0.0', caption: 'Спред от', note: 'На счетах Pro' }] },
    })

    expect(html.indexOf('На счетах Pro')).toBeGreaterThan(html.indexOf('Спред от'))
  })

  it('текст согласия формы виден в предпросмотре', () => {
    const html = render({
      type: 'form',
      props: { title: 'Заявка', consentText: 'Согласен на обработку данных' },
    })

    expect(html).toContain('Согласен на обработку данных')
  })
})

describe('оформление берётся из токенов', () => {
  it('фон блока ссылается на переменную токена, а не на цвет', () => {
    const html = render({
      type: 'quote',
      props: { text: 'Цитата' },
      style: { background: 'surface.raised' },
    })

    expect(html).toContain('var(--bkc-surface-raised)')
  })

  it('без фона в разметке нет инлайнового цвета', () => {
    expect(render({ type: 'quote', props: { text: 'Цитата' } })).not.toContain('background')
  })
})

describe('мусор не роняет предпросмотр', () => {
  it.each([null, 'строка', 42, [], {}])('значение %p', (value) => {
    expect(() => render(value)).not.toThrow()
  })
})

import type { PropField } from './props'

/**
 * Пропсы типов блоков (ТЗ 2.2).
 *
 * Вынесены из реестра отдельным файлом: реестр отвечает на вопрос «какие
 * блоки бывают», это — на вопрос «что у блока внутри». Вместе они читались бы
 * как одна простыня на восемьсот строк, в которой не найти ни того, ни другого.
 *
 * Пределы длины проставлены не для красоты. Заголовок в полтора экрана ломает
 * вёрстку блока, а описание длиннее предела поисковика обрезается на середине
 * фразы — и то и другое обнаруживается уже на витрине.
 */

/** Заголовок и подзаголовок — общее начало у большинства секций. */
const HEADING: readonly PropField[] = [
  { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
  { name: 'subtitle', label: 'Подзаголовок', kind: 'textarea', max: 300 },
]

const CTA: readonly PropField[] = [
  { name: 'ctaLabel', label: 'Надпись на кнопке', kind: 'text', max: 40 },
  { name: 'ctaHref', label: 'Куда ведёт кнопка', kind: 'link' },
]

const MEDIA_FIELD: PropField = { name: 'image', label: 'Изображение', kind: 'media' }

export const BLOCK_PROPS: Readonly<Record<string, readonly PropField[]>> = {
  // --- Промо-секции ---
  hero: [
    { name: 'title', label: 'Заголовок', kind: 'text', required: true, max: 120 },
    { name: 'subtitle', label: 'Подзаголовок', kind: 'textarea', max: 300 },
    MEDIA_FIELD,
    ...CTA,
    {
      name: 'secondaryLabel',
      label: 'Вторая кнопка',
      kind: 'text',
      max: 40,
      help: 'Две равнозначные кнопки снижают конверсию обеих: вторая — для «узнать больше», не для второго призыва.',
    },
    { name: 'secondaryHref', label: 'Куда ведёт вторая кнопка', kind: 'link' },
  ],
  'split-feature': [
    ...HEADING,
    MEDIA_FIELD,
    {
      name: 'mediaSide',
      label: 'Сторона изображения',
      kind: 'select',
      options: [
        { value: 'left', label: 'Слева' },
        { value: 'right', label: 'Справа' },
      ],
    },
    { name: 'body', label: 'Текст', kind: 'richtext' },
    ...CTA,
  ],
  'benefit-stack': [
    ...HEADING,
    {
      name: 'items',
      label: 'Преимущества',
      kind: 'items',
      max: 12,
      of: [
        { name: 'title', label: 'Заголовок', kind: 'text', required: true, max: 80 },
        { name: 'text', label: 'Пояснение', kind: 'textarea', max: 240 },
        { name: 'icon', label: 'Иконка', kind: 'media' },
      ],
    },
  ],
  metrics: [
    ...HEADING,
    {
      name: 'items',
      label: 'Показатели',
      kind: 'items',
      max: 8,
      of: [
        { name: 'value', label: 'Значение', kind: 'text', required: true, max: 20 },
        { name: 'caption', label: 'Подпись', kind: 'text', required: true, max: 80 },
        {
          name: 'note',
          label: 'Сноска',
          kind: 'text',
          max: 160,
          help: 'Здесь живёт оговорка к цифре. Цифра без оговорки в рекламе брокера — претензия регулятора.',
        },
      ],
    },
  ],
  'partner-logos': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'items',
      label: 'Логотипы',
      kind: 'items',
      max: 24,
      of: [
        { name: 'image', label: 'Логотип', kind: 'media', required: true },
        { name: 'name', label: 'Название', kind: 'text', required: true, max: 60 },
        { name: 'href', label: 'Ссылка', kind: 'link' },
      ],
    },
  ],
  testimonials: [
    ...HEADING,
    {
      name: 'items',
      label: 'Отзывы',
      kind: 'items',
      max: 12,
      of: [
        { name: 'quote', label: 'Текст отзыва', kind: 'textarea', required: true, max: 400 },
        { name: 'author', label: 'Автор', kind: 'text', required: true, max: 80 },
        { name: 'role', label: 'Кто он', kind: 'text', max: 80 },
        { name: 'avatar', label: 'Фото', kind: 'media' },
      ],
    },
  ],
  'cta-bar': [
    { name: 'title', label: 'Заголовок', kind: 'text', required: true, max: 120 },
    { name: 'text', label: 'Текст', kind: 'textarea', max: 240 },
    ...CTA,
  ],
  'promo-banner': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'limit',
      label: 'Сколько показывать',
      kind: 'number',
      min: 1,
      max: 12,
    },
  ],

  // --- Продуктовые ---
  'account-types': [
    ...HEADING,
    {
      name: 'items',
      label: 'Типы счетов',
      kind: 'items',
      max: 8,
      of: [
        { name: 'name', label: 'Название', kind: 'text', required: true, max: 60 },
        { name: 'minDeposit', label: 'Минимальный депозит', kind: 'text', max: 40 },
        { name: 'spread', label: 'Спред от', kind: 'text', max: 40 },
        { name: 'commission', label: 'Комиссия', kind: 'text', max: 60 },
        { name: 'leverage', label: 'Плечо', kind: 'text', max: 40 },
        { name: 'highlighted', label: 'Выделить', kind: 'boolean' },
      ],
    },
  ],
  'comparison-table': [
    ...HEADING,
    {
      name: 'columns',
      label: 'Колонки',
      kind: 'items',
      max: 6,
      of: [{ name: 'label', label: 'Заголовок колонки', kind: 'text', required: true, max: 60 }],
    },
    {
      name: 'rows',
      label: 'Строки',
      kind: 'items',
      max: 40,
      of: [
        { name: 'label', label: 'Название строки', kind: 'text', required: true, max: 80 },
        { name: 'values', label: 'Значения через точку с запятой', kind: 'text', max: 400 },
      ],
    },
  ],
  'instruments-table': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'group',
      label: 'Группа инструментов',
      kind: 'text',
      max: 60,
      help: 'Данные приходят из торгового ядра. Здесь только фильтр — списка инструментов CMS не хранит.',
    },
    { name: 'limit', label: 'Сколько показывать', kind: 'number', min: 1, max: 100 },
  ],
  'instrument-card': [
    { name: 'symbol', label: 'Символ', kind: 'text', required: true, max: 20 },
    { name: 'caption', label: 'Подпись', kind: 'text', max: 120 },
  ],
  calculator: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    { name: 'note', label: 'Оговорка', kind: 'textarea', max: 400 },
  ],
  'account-steps': [
    ...HEADING,
    {
      name: 'items',
      label: 'Шаги',
      kind: 'items',
      max: 8,
      of: [
        { name: 'title', label: 'Название шага', kind: 'text', required: true, max: 80 },
        { name: 'text', label: 'Пояснение', kind: 'textarea', max: 240 },
      ],
    },
    ...CTA,
  ],
  'pricing-grid': [
    ...HEADING,
    {
      name: 'items',
      label: 'Тарифы',
      kind: 'items',
      max: 6,
      of: [
        { name: 'name', label: 'Название', kind: 'text', required: true, max: 60 },
        { name: 'price', label: 'Цена', kind: 'text', max: 40 },
        {
          name: 'features',
          label: 'Что входит, через точку с запятой',
          kind: 'textarea',
          max: 600,
        },
        { name: 'href', label: 'Ссылка', kind: 'link' },
      ],
    },
  ],

  // --- Контентные ---
  'heading-text': [
    { name: 'title', label: 'Заголовок', kind: 'text', required: true, max: 160 },
    { name: 'text', label: 'Текст', kind: 'textarea', max: 1200 },
    {
      name: 'level',
      label: 'Уровень заголовка',
      kind: 'select',
      options: [
        { value: 'h2', label: 'H2' },
        { value: 'h3', label: 'H3' },
        { value: 'h4', label: 'H4' },
      ],
      help: 'H1 на странице один и берётся из её заголовка: два H1 — это ошибка разметки, а не оформление.',
    },
  ],
  'rich-text': [{ name: 'body', label: 'Текст', kind: 'richtext', required: true }],
  image: [
    { name: 'image', label: 'Изображение', kind: 'media' },
    {
      name: 'items',
      label: 'Галерея',
      kind: 'items',
      max: 24,
      of: [{ name: 'image', label: 'Изображение', kind: 'media', required: true }],
    },
    { name: 'caption', label: 'Подпись', kind: 'text', max: 200 },
  ],
  'video-embed': [
    {
      name: 'url',
      label: 'Адрес видео',
      kind: 'link',
      required: true,
      help: 'Ссылка на видеохостинг. Произвольный код вставки здесь недоступен — для него есть отдельный блок с отдельными полномочиями.',
    },
    { name: 'poster', label: 'Обложка', kind: 'media' },
    { name: 'caption', label: 'Подпись', kind: 'text', max: 200 },
  ],
  faq: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'items',
      label: 'Вопросы',
      kind: 'items',
      max: 30,
      of: [
        { name: 'question', label: 'Вопрос', kind: 'text', required: true, max: 200 },
        { name: 'answer', label: 'Ответ', kind: 'textarea', required: true, max: 1200 },
      ],
      help: 'Из этих пунктов собирается разметка FAQPage для поисковика — отдельно её заполнять не нужно.',
    },
  ],
  tabs: [
    {
      name: 'items',
      label: 'Вкладки',
      kind: 'items',
      max: 8,
      of: [{ name: 'label', label: 'Название вкладки', kind: 'text', required: true, max: 60 }],
      help: 'Содержимое вкладок складывается в слот «panels» по порядку.',
    },
  ],
  timeline: [
    ...HEADING,
    {
      name: 'items',
      label: 'События',
      kind: 'items',
      max: 20,
      of: [
        { name: 'date', label: 'Когда', kind: 'text', required: true, max: 40 },
        { name: 'title', label: 'Что произошло', kind: 'text', required: true, max: 120 },
        { name: 'text', label: 'Подробности', kind: 'textarea', max: 400 },
      ],
    },
  ],
  quote: [
    { name: 'text', label: 'Цитата', kind: 'textarea', required: true, max: 600 },
    { name: 'author', label: 'Автор', kind: 'text', max: 80 },
    { name: 'role', label: 'Кто он', kind: 'text', max: 80 },
  ],
  table: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'columns',
      label: 'Колонки',
      kind: 'items',
      max: 10,
      of: [{ name: 'label', label: 'Заголовок колонки', kind: 'text', required: true, max: 60 }],
    },
    {
      name: 'rows',
      label: 'Строки',
      kind: 'items',
      max: 100,
      of: [{ name: 'cells', label: 'Ячейки через точку с запятой', kind: 'text', max: 600 }],
    },
  ],
  downloads: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'items',
      label: 'Файлы',
      kind: 'items',
      max: 30,
      of: [
        { name: 'file', label: 'Файл', kind: 'media', required: true },
        { name: 'label', label: 'Название', kind: 'text', required: true, max: 120 },
        { name: 'note', label: 'Пояснение', kind: 'text', max: 200 },
      ],
    },
  ],

  // --- Динамические ---
  'news-feed': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    { name: 'limit', label: 'Сколько показывать', kind: 'number', min: 1, max: 24 },
    { name: 'moreLabel', label: 'Надпись «показать ещё»', kind: 'text', max: 40 },
    { name: 'moreHref', label: 'Куда ведёт «показать ещё»', kind: 'link' },
  ],
  'broadcast-grid': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    { name: 'limit', label: 'Сколько показывать', kind: 'number', min: 1, max: 24 },
  ],
  'service-status': [{ name: 'title', label: 'Заголовок', kind: 'text', max: 120 }],
  'economic-calendar': [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    {
      name: 'impact',
      label: 'Важность событий',
      kind: 'select',
      options: [
        { value: 'all', label: 'Все' },
        { value: 'medium', label: 'Средняя и выше' },
        { value: 'high', label: 'Только высокая' },
      ],
    },
  ],
  'quote-ticker': [
    {
      name: 'symbols',
      label: 'Символы через запятую',
      kind: 'text',
      max: 400,
      help: 'Котировки приходят из торгового ядра. CMS хранит только список того, что показывать.',
    },
  ],

  // --- Формы ---
  form: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    { name: 'text', label: 'Пояснение', kind: 'textarea', max: 400 },
    { name: 'submitLabel', label: 'Надпись на кнопке', kind: 'text', max: 40 },
    {
      name: 'consentText',
      label: 'Текст согласия',
      kind: 'textarea',
      required: true,
      max: 600,
      help: 'Согласие на обработку данных обязательно: форма без него собирает персональные данные без основания.',
    },
  ],
  newsletter: [
    { name: 'title', label: 'Заголовок', kind: 'text', max: 120 },
    { name: 'text', label: 'Пояснение', kind: 'textarea', max: 300 },
    { name: 'submitLabel', label: 'Надпись на кнопке', kind: 'text', max: 40 },
    { name: 'consentText', label: 'Текст согласия', kind: 'textarea', required: true, max: 600 },
  ],

  // --- Служебные ---
  divider: [],
  spacer: [
    {
      name: 'size',
      label: 'Высота',
      kind: 'select',
      options: [
        { value: 's', label: 'Малая' },
        { value: 'm', label: 'Средняя' },
        { value: 'l', label: 'Большая' },
      ],
    },
  ],
  anchor: [
    {
      name: 'id',
      label: 'Идентификатор',
      kind: 'text',
      required: true,
      max: 60,
      help: 'То, что окажется после решётки в адресе: #accounts.',
    },
  ],
  columns: [
    {
      name: 'gap',
      label: 'Промежуток',
      kind: 'select',
      options: [
        { value: 's', label: 'Малый' },
        { value: 'm', label: 'Средний' },
        { value: 'l', label: 'Большой' },
      ],
    },
  ],
  'section-ref': [
    {
      name: 'key',
      label: 'Ключ секции',
      kind: 'text',
      required: true,
      max: 60,
      help: 'Ключ переиспользуемой секции. Своя секция сайта перекрывает секцию бренда с тем же ключом.',
    },
  ],
  'raw-embed': [
    {
      name: 'html',
      label: 'Разметка',
      kind: 'textarea',
      required: true,
      max: 20000,
      help: 'Доступно только разработчику. Содержимое санитайзится, а факт правки попадает в журнал.',
    },
  ],
}

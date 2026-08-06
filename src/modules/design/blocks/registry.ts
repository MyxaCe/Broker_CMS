/**
 * Реестр блоков (ТЗ 2.2).
 *
 * > «реестр расширяется разработчиком, не редактором»
 *
 * Поэтому он живёт в коде, а не в базе. Причина не в удобстве: у блока есть
 * типизированные пропсы и вёрстка, и завести тип блока без кода, который умеет
 * его нарисовать, — значит положить на страницу то, чего не существует.
 *
 * Реестр — единственный источник истины сразу для трёх вещей: что предлагает
 * админка, что пропускает валидация релиза и что описано в контракте выдачи.
 */

/** Группы для интерфейса редактора. Порядок — порядок в списке выбора. */
export const BLOCK_GROUPS = ['promo', 'product', 'content', 'dynamic', 'form', 'utility'] as const

export type BlockGroup = (typeof BLOCK_GROUPS)[number]

export const BLOCK_GROUP_LABELS: Record<BlockGroup, string> = {
  promo: 'Промо-секции',
  product: 'Продуктовые',
  content: 'Контентные',
  dynamic: 'Динамические',
  form: 'Формы',
  utility: 'Служебные',
}

/**
 * Коллекции, к которым может обращаться data-bound блок (ТЗ 2.2).
 *
 * Перечень закрытый: блок, умеющий запросить произвольную коллекцию, — это
 * способ показать на витрине что угодно, включая учётные записи.
 */
export const BOUND_COLLECTIONS = ['articles', 'videos', 'promos'] as const

export type BoundCollection = (typeof BOUND_COLLECTIONS)[number]

export interface BlockDefinition {
  readonly type: string
  readonly title: string
  readonly group: BlockGroup
  /**
   * Предопределённые варианты типа. Пустой список означает единственный вид.
   * Вариант — это выбор из готовых вёрсток, а не набор свободных настроек.
   */
  readonly variants: readonly string[]
  /**
   * Слоты вложенности. Пусто — тип вложенности не разрешает.
   *
   * Разрешать вложенность везде значило бы позволить редактору собрать
   * бесконечную матрёшку, которую невозможно ни отрисовать, ни осмыслить.
   */
  readonly slots: readonly string[]
  /**
   * Блок описывает **запрос** к коллекции, а не копию контента (ТЗ 2.2).
   * Иначе конструктор превращается в генератор дублей.
   */
  readonly boundTo?: BoundCollection
  /** Требует ли блок изображения — влияет на проверку обязательного alt. */
  readonly hasMedia?: boolean
  /**
   * Блок доступен только кросс-тенантной роли. Для `raw-embed`: произвольная
   * разметка на странице брокера — это то, что нельзя дать редактору.
   */
  readonly restricted?: boolean
}

/**
 * Стартовая библиотека из ТЗ 2.2.
 *
 * Перечислена целиком, включая то, что ещё не имеет вёрстки: реестр — это
 * договорённость о составе, и неполный список привёл бы к тому, что
 * недостающие типы завели бы мимо него.
 */
export const BLOCK_REGISTRY: readonly BlockDefinition[] = [
  // --- Промо-секции ---
  {
    type: 'hero',
    title: 'Герой',
    group: 'promo',
    variants: ['centered', 'split', 'media-right', 'minimal', 'fullscreen'],
    slots: [],
    hasMedia: true,
  },
  {
    type: 'split-feature',
    title: 'Split-фича',
    group: 'promo',
    variants: [],
    slots: [],
    hasMedia: true,
  },
  { type: 'benefit-stack', title: 'Стек преимуществ', group: 'promo', variants: [], slots: [] },
  { type: 'metrics', title: 'Метрики и цифры', group: 'promo', variants: [], slots: [] },
  {
    type: 'partner-logos',
    title: 'Логотипы партнёров',
    group: 'promo',
    variants: [],
    slots: [],
    hasMedia: true,
  },
  { type: 'testimonials', title: 'Отзывы', group: 'promo', variants: [], slots: [] },
  { type: 'cta-bar', title: 'CTA-полоса', group: 'promo', variants: [], slots: [] },
  {
    type: 'promo-banner',
    title: 'Баннер акции',
    group: 'promo',
    variants: [],
    slots: [],
    boundTo: 'promos',
  },

  // --- Продуктовые ---
  {
    type: 'account-types',
    title: 'Таблица типов счетов',
    group: 'product',
    variants: [],
    slots: [],
  },
  {
    type: 'comparison-table',
    title: 'Сравнительная таблица',
    group: 'product',
    variants: [],
    slots: [],
  },
  {
    type: 'instruments-table',
    title: 'Таблица инструментов',
    group: 'product',
    variants: ['compact', 'detailed'],
    slots: [],
  },
  {
    type: 'instrument-card',
    title: 'Карточка инструмента',
    group: 'product',
    variants: [],
    slots: [],
  },
  {
    type: 'calculator',
    title: 'Калькулятор',
    group: 'product',
    variants: ['margin', 'swap', 'profit'],
    slots: [],
  },
  {
    type: 'account-steps',
    title: 'Шаги открытия счёта',
    group: 'product',
    variants: [],
    slots: [],
  },
  { type: 'pricing-grid', title: 'Тарифная сетка', group: 'product', variants: [], slots: [] },

  // --- Контентные ---
  { type: 'heading-text', title: 'Заголовок и текст', group: 'content', variants: [], slots: [] },
  { type: 'rich-text', title: 'Форматированный текст', group: 'content', variants: [], slots: [] },
  {
    type: 'image',
    title: 'Изображение или галерея',
    group: 'content',
    variants: ['single', 'gallery'],
    slots: [],
    hasMedia: true,
  },
  { type: 'video-embed', title: 'Видео', group: 'content', variants: [], slots: [] },
  { type: 'faq', title: 'Аккордеон и FAQ', group: 'content', variants: [], slots: [] },
  { type: 'tabs', title: 'Табы', group: 'content', variants: [], slots: ['panels'] },
  { type: 'timeline', title: 'Таймлайн', group: 'content', variants: [], slots: [] },
  { type: 'quote', title: 'Цитата', group: 'content', variants: [], slots: [] },
  { type: 'table', title: 'Таблица', group: 'content', variants: [], slots: [] },
  { type: 'downloads', title: 'Файлы для скачивания', group: 'content', variants: [], slots: [] },

  // --- Динамические ---
  {
    type: 'news-feed',
    title: 'Лента новостей',
    group: 'dynamic',
    variants: ['grid', 'list', 'compact'],
    slots: [],
    boundTo: 'articles',
  },
  {
    type: 'broadcast-grid',
    title: 'Сетка эфиров',
    group: 'dynamic',
    variants: [],
    slots: [],
    boundTo: 'videos',
  },
  { type: 'service-status', title: 'Статус сервисов', group: 'dynamic', variants: [], slots: [] },
  {
    type: 'economic-calendar',
    title: 'Экономический календарь',
    group: 'dynamic',
    variants: [],
    slots: [],
  },
  { type: 'quote-ticker', title: 'Котировочная лента', group: 'dynamic', variants: [], slots: [] },

  // --- Формы ---
  {
    type: 'form',
    title: 'Форма',
    group: 'form',
    variants: ['lead', 'support', 'career'],
    slots: [],
  },
  { type: 'newsletter', title: 'Подписка на рассылку', group: 'form', variants: [], slots: [] },

  // --- Служебные ---
  { type: 'divider', title: 'Разделитель', group: 'utility', variants: [], slots: [] },
  { type: 'spacer', title: 'Отступ', group: 'utility', variants: [], slots: [] },
  { type: 'anchor', title: 'Якорь', group: 'utility', variants: [], slots: [] },
  {
    type: 'columns',
    title: 'Сетка и колонки',
    group: 'utility',
    variants: ['two', 'three', 'four'],
    slots: ['columns'],
  },
  {
    /**
     * Ссылка на переиспользуемую секцию (ТЗ 2.2).
     *
     * Именно ссылка, а не копия: секция «Как открыть счёт» стоит на десятке
     * страниц, и правка её текста обязана доехать до всех сразу. Копия
     * означала бы десять расходящихся версий одного регуляторно значимого
     * текста.
     *
     * Слотов нет: содержимое приходит из секции, и вкладывать в ссылку нечего.
     */
    type: 'section-ref',
    title: 'Переиспользуемая секция',
    group: 'utility',
    variants: [],
    slots: [],
  },
  {
    /**
     * Произвольная разметка на сайте брокера — это то, чего редактору давать
     * нельзя: один вставленный скрипт превращает страницу в чужую. Доступен
     * только кросс-тенантной роли, с санитайзом и записью в журнал (ТЗ 2.2).
     */
    type: 'raw-embed',
    title: 'Произвольный код',
    group: 'utility',
    variants: [],
    slots: [],
    restricted: true,
  },
]

const BY_TYPE = new Map(BLOCK_REGISTRY.map((block) => [block.type, block]))

export function findBlock(type: string): BlockDefinition | undefined {
  return BY_TYPE.get(type)
}

export function isKnownBlock(type: string): boolean {
  return BY_TYPE.has(type)
}

/**
 * Допустим ли вариант для типа.
 *
 * Отсутствие варианта допустимо всегда: у большинства типов вариант один и
 * задавать его незачем.
 */
export function isAllowedVariant(type: string, variant: string | null | undefined): boolean {
  const definition = BY_TYPE.get(type)

  if (definition === undefined) {
    return false
  }

  if (variant === null || variant === undefined || variant === '') {
    return true
  }

  return definition.variants.includes(variant)
}

export function isAllowedSlot(type: string, slot: string): boolean {
  return BY_TYPE.get(type)?.slots.includes(slot) ?? false
}

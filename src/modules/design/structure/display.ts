/**
 * Правила показа попапа и вариант шапки (ТЗ 2.2, DEBT-015).
 *
 * > «Шапка (несколько вариантов + мега-меню), … попапы с правилами показа
 * > (задержка, скролл, выход, частота)»
 *
 * Попап без правил показа — это не упрощённый попап, а неработающий: правила
 * показа и есть его поведение. Редактор, увидев вид `popup` в списке, разумно
 * решит, что механизм готов.
 *
 * Решение принимает CMS, показывает витрина. Поэтому здесь закрытые перечни и
 * числа с границами, а не свободная форма: правило, которое витрина не умеет
 * исполнить, равносильно отсутствующему, и узнать об этом мы бы не смогли.
 */

/**
 * Как часто попап показывается одному человеку.
 *
 * Перечень закрытый. Свободное «раз в N дней» потребовало бы от каждой
 * витрины своей арифметики дат, а расхождение проявилось бы как «попап
 * показывается чаще, чем договаривались» — то есть жалобой, а не ошибкой.
 */
export const POPUP_FREQUENCIES = [
  'once',
  'once-per-session',
  'once-per-day',
  'every-visit',
] as const

export type PopupFrequency = (typeof POPUP_FREQUENCIES)[number]

export const POPUP_FREQUENCY_LABELS: Record<PopupFrequency, string> = {
  once: 'Один раз и больше никогда',
  'once-per-session': 'Раз за сессию',
  'once-per-day': 'Раз в сутки',
  'every-visit': 'При каждом заходе',
}

/** Варианты шапки (ТЗ 2.2). Перечень закрытый по той же причине. */
export const HEADER_VARIANTS = ['default', 'compact', 'transparent', 'landing'] as const

export type HeaderVariant = (typeof HEADER_VARIANTS)[number]

export const HEADER_VARIANT_LABELS: Record<HeaderVariant, string> = {
  default: 'Обычная',
  compact: 'Компактная',
  transparent: 'Прозрачная поверх баннера',
  landing: 'Лендинговая: без меню',
}

/** Разумный верхний предел задержки: дольше минуты попап уже не увидят. */
export const MAX_POPUP_DELAY_SECONDS = 600

export interface PopupDisplayRules {
  /** Через сколько секунд после открытия страницы. `null` — без задержки. */
  readonly delaySeconds: number | null
  /** На какой доле прокрутки, в процентах. `null` — не зависит от прокрутки. */
  readonly scrollPercent: number | null
  /** Показывать при намерении уйти со страницы. */
  readonly onExitIntent: boolean
  readonly frequency: PopupFrequency
}

/**
 * Умолчание, которое **не** притворяется настройкой.
 *
 * Попап без заданных правил показывается сразу и каждому — это поведение, а
 * не отсутствие поведения, и назвать его надо явно. Молчаливое «показывать
 * когда-нибудь» означало бы, что редактор не отличит ненастроенный попап от
 * настроенного на немедленный показ.
 */
export const DEFAULT_POPUP_DISPLAY: PopupDisplayRules = {
  delaySeconds: null,
  scrollPercent: null,
  onExitIntent: false,
  frequency: 'every-visit',
}

function boundedInteger(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)

  /**
   * Негодное значение — это `null`, то есть «условие не задано», а не ноль.
   * Ноль здесь означал бы «показать немедленно» — правдоподобное поведение на
   * месте непрочитанной настройки.
   */
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    return null
  }

  return parsed
}

export function isPopupFrequency(value: unknown): value is PopupFrequency {
  return typeof value === 'string' && (POPUP_FREQUENCIES as readonly string[]).includes(value)
}

export function isHeaderVariant(value: unknown): value is HeaderVariant {
  return typeof value === 'string' && (HEADER_VARIANTS as readonly string[]).includes(value)
}

/**
 * Читает правила показа из карточки области.
 *
 * Неизвестная частота заменяется на `every-visit`, а не отбрасывается
 * молчаливо: это самое **частое** из возможных поведений, то есть самое
 * заметное. Ошибку, которая делает попап назойливым, заметят и починят;
 * ошибку, которая его прячет, не заметит никто.
 */
export function readPopupDisplay(raw: unknown): PopupDisplayRules {
  if (raw === null || typeof raw !== 'object') {
    return DEFAULT_POPUP_DISPLAY
  }

  const record = raw as Record<string, unknown>

  return {
    delaySeconds: boundedInteger(record.delaySeconds, MAX_POPUP_DELAY_SECONDS),
    scrollPercent: boundedInteger(record.scrollPercent, 100),
    onExitIntent: record.onExitIntent === true,
    frequency: isPopupFrequency(record.frequency) ? record.frequency : 'every-visit',
  }
}

export function readHeaderVariant(raw: unknown): HeaderVariant {
  return isHeaderVariant(raw) ? raw : 'default'
}

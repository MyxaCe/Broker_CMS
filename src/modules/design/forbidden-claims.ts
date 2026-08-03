/**
 * Стоп-словарь обещаний доходности (ТЗ 2.4).
 *
 * Обещание гарантированного дохода — не стилистическая оплошность, а
 * нарушение, за которое отвечает брокер. Поэтому проверка блокирующая: текст
 * с такой формулировкой не должен попасть в релиз, даже если редактор уверен,
 * что «так все пишут».
 */

export type ContentClass = 'marketing' | 'legal' | 'compliance' | 'education'

export interface TextItem {
  /** Где искать: страница, блок, документ. */
  readonly location: string
  readonly contentClass: ContentClass
  readonly text: string
}

export interface ForbiddenMatch {
  readonly phrase: string
  /** Фрагмент вокруг совпадения — редактору нужно видеть, что именно нашли. */
  readonly fragment: string
}

/**
 * Основа словаря. Хранятся **основы**, а не полные слова: русский текст
 * склоняется, и список точных форм устареет на первом же новом тексте.
 *
 * Список расширяемый: у бренда и юрисдикции могут быть свои требования,
 * и они добавляются, а не заменяют этот набор.
 */
export const DEFAULT_FORBIDDEN_PHRASES: readonly string[] = [
  /**
   * Основа намеренно короткая: она покрывает «гарантирован», «гарантируем»,
   * «гарантия» и «гарантийный». Последнее — ложное срабатывание, и это
   * осознанный размен: пропустить обещание доходности дороже, чем заставить
   * редактора переформулировать одну безобидную фразу. Найденный фрагмент
   * показывается, так что разобраться — секунда.
   */
  'гарант',
  'без риска',
  'безриск',
  'без потерь',
  'стабильный доход',
  'фиксированный доход',
  'пассивный доход',
  'guaranteed',
  'risk-free',
  'riskfree',
  'no risk',
  'no-loss',
  'fixed income',
]

const FRAGMENT_RADIUS = 40

/**
 * Пробелы и разделители, визуально неотличимые от обычного пробела или пустоты:
 * неразрывный, узкий неразрывный, цифровой, склеивающий нулевой ширины и
 * собственно нулевой ширины.
 *
 * Перечислены кодами, а не символами, намеренно: выражение с невидимыми
 * символами внутри невозможно ни проверить на ревью, ни исправить осознанно.
 * Линтер такие символы в исходниках запрещает — и правильно делает.
 *
 * Именно они позволяют формулировке «без риска» пройти мимо словаря, выглядя
 * при этом на странице совершенно обычно.
 */
/**
 * Обрабатываются по-разному, и это не мелочь: пробел нулевой ширины,
 * заменённый на обычный, разрывает слово — «гаранти<ноль>рован» превращается
 * в «гаранти рован» и перестаёт совпадать с основой. Такие символы нужно
 * удалять, а видимые неразрывные пробелы — заменять.
 */
const SPACE_LIKE_CODES = [
  0x00a0, // неразрывный пробел
  0x202f, // узкий неразрывный пробел
  0x2007, // цифровой пробел
]

const ZERO_WIDTH_CODES = [
  0x200b, // пробел нулевой ширины
  0x200c, // несоединитель нулевой ширины
  0x200d, // соединитель нулевой ширины
  0x2060, // склеивающий нулевой ширины
  0xfeff, // неразрывный пробел нулевой ширины
]

function charClass(codes: readonly number[]): RegExp {
  return new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join('')}]`, 'g')
}

const SPACE_LIKE = charClass(SPACE_LIKE_CODES)
const ZERO_WIDTH = charClass(ZERO_WIDTH_CODES)

/**
 * Приводит текст к виду, в котором сравнение не зависит от оформления:
 * регистр, `ё`, невидимые разделители, повторяющиеся пробелы.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(ZERO_WIDTH, '')
    .replace(SPACE_LIKE, ' ')
    .replace(/\s+/g, ' ')
}

export function findForbiddenPhrases(
  text: string,
  phrases: readonly string[] = DEFAULT_FORBIDDEN_PHRASES,
): ForbiddenMatch[] {
  const haystack = normalize(text)
  const matches: ForbiddenMatch[] = []

  for (const phrase of phrases) {
    const needle = normalize(phrase)
    const index = haystack.indexOf(needle)

    if (index === -1) continue

    const from = Math.max(0, index - FRAGMENT_RADIUS)
    const to = Math.min(haystack.length, index + needle.length + FRAGMENT_RADIUS)

    matches.push({
      phrase,
      fragment: `${from > 0 ? '…' : ''}${haystack.slice(from, to).trim()}${to < haystack.length ? '…' : ''}`,
    })
  }

  return matches
}

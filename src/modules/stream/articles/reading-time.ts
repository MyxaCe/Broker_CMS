/**
 * Время чтения материала (ТЗ 1.1: `readingMinutes` вычисляется).
 *
 * Вычисляется, а не вводится: введённое руками разойдётся с текстом при первой
 * же правке и будет врать тем увереннее, чем дольше живёт материал.
 */

/**
 * Слов в минуту.
 *
 * 180 — осознанно ниже привычных 200–250: речь о финансовой аналитике с
 * числами и терминами, которую читают медленнее беллетристики. Заниженная
 * оценка ошибается в сторону «дольше, чем сказали», и это менее неприятная
 * ошибка.
 */
const WORDS_PER_MINUTE = 180

/**
 * Извлекает текст из структуры редактора.
 *
 * Обходит **любую** вложенность, не зная её схемы: структура редактора
 * меняется вместе с набором блоков, и разбор, знающий её наизусть, ломался бы
 * при каждом добавлении блока.
 */
export function extractText(node: unknown): string {
  if (typeof node === 'string') {
    return node
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }

  if (node === null || typeof node !== 'object') {
    return ''
  }

  const record = node as Record<string, unknown>
  const parts: string[] = []

  if (typeof record.text === 'string') {
    parts.push(record.text)
  }

  for (const [key, value] of Object.entries(record)) {
    /**
     * `text` уже взят выше, а служебные поля разбирать незачем: `type`,
     * `format` и им подобные добавили бы в подсчёт слова вроде «paragraph».
     */
    if (key === 'text' || key === 'type' || key === 'format' || key === 'version') {
      continue
    }

    if (value !== null && typeof value === 'object') {
      parts.push(extractText(value))
    }
  }

  return parts.join(' ')
}

export function countWords(text: string): number {
  const trimmed = text.trim()

  if (trimmed === '') {
    return 0
  }

  return trimmed.split(/\s+/u).length
}

/**
 * Оценка в минутах.
 *
 * Пустой текст даёт `0`, а не `1`: «1 минута чтения» у пустого черновика
 * выглядит как настоящее значение и мешает заметить, что текста нет.
 * Любой непустой текст — минимум минута.
 */
export function estimateReadingMinutes(body: unknown): number {
  const words = countWords(extractText(body))

  if (words === 0) {
    return 0
  }

  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

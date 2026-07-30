/**
 * Вычисление изменений для журнала аудита (ТЗ 5.2).
 *
 * Чистая функция: журнал обязан быть предсказуем, а «что попало в аудит» —
 * проверяемо тестами, а не наблюдением за живой системой.
 */

export interface AuditChange {
  readonly field: string
  readonly before: unknown
  readonly after: unknown
}

/** Значение, которым замещается содержимое чувствительного поля. */
export const REDACTED = '<скрыто>'

/**
 * Поля, значения которых не попадают в журнал никогда (ТЗ разд. 6).
 *
 * Сам факт изменения фиксируется — без него нельзя расследовать смену пароля
 * или ключа, — но значения замещаются. Сравнение по вхождению подстроки:
 * список полей будет расти, и точный перечень устареет раньше, чем его
 * вспомнят обновить.
 */
const SENSITIVE_MARKERS = ['password', 'salt', 'hash', 'secret', 'token', 'apikey', 'pepper']

/**
 * Поля, которые меняются сами и не несут смысла для расследования.
 * Их присутствие превращает журнал в шум, в котором не видно существенного.
 */
const IGNORED_FIELDS = new Set([
  'id',
  'collection',
  'createdAt',
  'updatedAt',
  'loginAttempts',
  'lockUntil',
  'sessions',
  'resetPasswordToken',
  'resetPasswordExpiration',
  '_verified',
  '_verificationToken',
])

export function isSensitiveField(field: string): boolean {
  /**
   * Разделители убираются перед сравнением: одно и то же поле встречается как
   * `apiKey`, `api_key` и `API-KEY` — в коде, в колонках БД и во внешних
   * ответах. Проверка, чувствительная к оформлению, пропустила бы часть из них,
   * и секрет утёк бы в журнал именно в том написании, о котором не подумали.
   */
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_MARKERS.some((marker) => normalized.includes(marker))
}

/**
 * Похоже ли значение на развёрнутый документ, а не на обычный объект.
 *
 * Признак — наличие идентификатора вместе со служебными датами: их проставляет
 * хранилище, а не редактор. Строки массивов под это не подпадают: у них есть
 * `id`, но нет `createdAt`.
 */
function isPopulatedDocument(value: Record<string, unknown>): boolean {
  return 'id' in value && ('createdAt' in value || 'updatedAt' in value)
}

/**
 * Сворачивает развёрнутые связи до идентификаторов.
 *
 * Без этого в журнал попадает содержимое связанных документов целиком — включая
 * данные ВЫШЕСТОЯЩЕГО тенанта, вложенные на несколько уровней. Для записи,
 * которую видит редактор дочернего сайта, это прямая утечка: он получает чужие
 * поля внутри собственного журнала.
 *
 * Плюс запись становится читаемой: «родитель изменён с 2 на 3» вместо трёх
 * экранов вложенного JSON.
 */
export function normalizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeAuditValue)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>

  if (isPopulatedDocument(record)) {
    return record.id
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(record)) {
    result[key] = normalizeAuditValue(nested)
  }

  return result
}

function isEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  if (left === null || right === null) return false

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/**
 * Сравнивает состояние до и после.
 *
 * `before === null` означает создание: в журнал попадают все заполненные поля,
 * потому что «что именно завели» — такой же предмет расследования, как «что
 * изменили».
 */
export function computeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): AuditChange[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
  const changes: AuditChange[] = []

  for (const field of [...fields].sort()) {
    if (IGNORED_FIELDS.has(field)) continue

    /**
     * Значение нормализуется как есть: `null` и `undefined` различаются
     * («поле очищено» и «поля не было»), и схлопывать их здесь нельзя —
     * ниже они обрабатываются отдельным правилом.
     */
    const previous = before === null ? undefined : normalizeAuditValue(before[field])
    const next = normalizeAuditValue(after[field])

    if (isEqual(previous, next)) continue

    // Пустое значение и отсутствие поля — одно и то же; иначе журнал заполняется
    // переходами undefined → null, которых для человека не существует.
    if (previous == null && next == null) continue

    if (isSensitiveField(field)) {
      changes.push({
        field,
        before: previous === undefined ? undefined : REDACTED,
        after: REDACTED,
      })
      continue
    }

    changes.push({ field, before: previous, after: next })
  }

  return changes
}

/**
 * Короткое человекочитаемое описание — то, что видно в списке журнала до
 * раскрытия подробностей.
 */
export function summarizeChanges(changes: readonly AuditChange[]): string {
  if (changes.length === 0) {
    return 'без изменений'
  }

  const names = changes.map((change) => change.field)
  const shown = names.slice(0, 5).join(', ')

  return names.length > 5 ? `${shown} и ещё ${names.length - 5}` : shown
}

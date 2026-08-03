import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Ключи доставки (ТЗ разд. 6).
 *
 * Три требования определяют устройство целиком:
 *
 *  1. ключ не хранится в открытом виде — в БД только его отпечаток;
 *  2. сравнение отпечатков идёт за постоянное время;
 *  3. по ключу должна находиться ровно одна запись, без перебора таблицы.
 *
 * Отсюда формат из двух частей: открытый идентификатор для поиска и секрет,
 * от которого хранится только отпечаток.
 */

/** Различимый префикс: утёкший ключ должен быть опознаваем в логах и репозиториях. */
export const KEY_PREFIX = 'bkc'

const ID_BYTES = 9
const SECRET_BYTES = 32

export interface GeneratedKey {
  /** Показывается один раз при выдаче и больше нигде не хранится. */
  readonly plaintext: string
  /** Открытая часть: по ней ищется запись. */
  readonly keyId: string
  /** Отпечаток секрета — это и попадает в БД. */
  readonly secretHash: string
}

export class KeyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyFormatError'
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

/**
 * Отпечаток секрета.
 *
 * С «перцем» из конфигурации: без него отпечатки зависят только от секрета, и
 * утёкшая копия таблицы позволяет проверять догадки офлайн. Перец хранится вне
 * БД, поэтому одна лишь база для подбора бесполезна.
 */
export function hashSecret(secret: string, pepper: string): string {
  if (pepper.trim() === '') {
    throw new KeyFormatError('Отпечаток без «перца» не вычисляется — см. DELIVERY_KEY_PEPPER.')
  }

  return createHash('sha256').update(pepper).update('|').update(secret).digest('hex')
}

export function generateKey(pepper: string): GeneratedKey {
  /**
   * Идентификатор — шестнадцатеричный, а не base64url: в алфавите base64url
   * есть символ `_`, который здесь служит разделителем. Идентификатор с ним
   * внутри разваливал разбор ключа — секрет обрезался, и корректный ключ
   * отвергался. Поймано тестом.
   *
   * Секрет остаётся base64url: он идёт последним, и всё после второго
   * разделителя считается секретом целиком.
   */
  const keyId = randomBytes(ID_BYTES).toString('hex')
  const secret = base64url(randomBytes(SECRET_BYTES))

  return {
    plaintext: `${KEY_PREFIX}_${keyId}_${secret}`,
    keyId,
    secretHash: hashSecret(secret, pepper),
  }
}

export interface ParsedKey {
  readonly keyId: string
  readonly secret: string
}

/**
 * Разбирает предъявленный ключ.
 *
 * Возвращает `null` вместо исключения: неверный формат — это рядовой отказ, а
 * не исключительная ситуация, и обрабатывается он так же, как неверный секрет.
 * Разное поведение на «кривой ключ» и «неверный ключ» само по себе подсказка.
 */
export function parseKey(value: string): ParsedKey | null {
  const trimmed = value.trim()

  /**
   * Разбор по первым двум разделителям, а не `split` по всем: секрет закодирован
   * в base64url, где `_` — допустимый символ. Разбиение по всем разделителям
   * обрезало бы секрет на первом же таком символе.
   */
  const firstSeparator = trimmed.indexOf('_')
  if (firstSeparator === -1) return null

  const secondSeparator = trimmed.indexOf('_', firstSeparator + 1)
  if (secondSeparator === -1) return null

  const prefix = trimmed.slice(0, firstSeparator)
  const keyId = trimmed.slice(firstSeparator + 1, secondSeparator)
  const secret = trimmed.slice(secondSeparator + 1)

  if (prefix !== KEY_PREFIX) return null
  /** Идентификатор шестнадцатеричный — посторонние символы в нём недопустимы. */
  if (!/^[0-9a-f]{8,}$/.test(keyId)) return null
  if (secret.length < 16) return null

  return { keyId, secret }
}

/**
 * Сравнение за постоянное время.
 *
 * Обычное `===` завершается на первом несовпавшем символе, и по времени ответа
 * восстанавливается правильный префикс отпечатка. Длины сравниваются отдельно:
 * `timingSafeEqual` на буферах разной длины бросает исключение.
 */
export function secretMatches(secret: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashSecret(secret, pepper), 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')

  if (actual.length !== expected.length) {
    return false
  }

  return timingSafeEqual(actual, expected)
}

/**
 * Извлекает ключ из заголовка `Authorization`.
 *
 * Схема обязательна: без неё значение заголовка легко перепутать с чем-то
 * другим, а «сырой» ключ в заголовке чаще попадает в логи прокси.
 */
export function extractBearer(header: string | null): string | null {
  if (header === null) return null

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

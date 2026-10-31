import { normalizeRelationId } from '../shared/relation'

import type { CollectionLayerState, LayerState } from './types'

/**
 * Брендовые ассеты и денежные настройки тенанта — слои, читаемые по цепочке
 * `brand → region → site` (ТЗ 2.1, 3.3).
 *
 * Файл чистый: он умеет читать слой из документа и ничего не знает ни о
 * Payload, ни о медиатеке. Разрешение по цепочке делает общий
 * `resolveField`/`resolveCollection` — заводить для бренда собственное
 * наследование значило бы получить второй ответ на вопрос «кто побеждает».
 */

/**
 * Слоты брендовых ассетов (ТЗ 2.1).
 *
 * Перечень закрытый, а не произвольные «дополнительные файлы»: каждый слот
 * имеет потребителя, который знает, что именно он берёт. Свободный список
 * ассетов потребовал бы от витрины догадываться по имени файла.
 *
 * Дефолтный OG-образ сюда намеренно НЕ входит: он уже живёт в SEO-профиле
 * слоя В (`seo-profiles.defaultOgImage`, миграция `20260807_140435_seo_layer`)
 * и наследуется по той же цепочке. Второе поле того же смысла означало бы два
 * источника истины и вопрос «какой из них победит» при каждой правке.
 */
export const BRAND_ASSET_SLOTS = [
  'logoLight',
  'logoDark',
  'logoMono',
  'logoMark',
  'favicon',
  'emailLogo',
] as const

export type BrandAssetSlot = (typeof BRAND_ASSET_SLOTS)[number]

export const BRAND_ASSET_LABELS: Readonly<Record<BrandAssetSlot, string>> = {
  logoLight: 'Логотип (светлая тема)',
  logoDark: 'Логотип (тёмная тема)',
  logoMono: 'Логотип (моно)',
  logoMark: 'Знак без надписи',
  favicon: 'Фавикон',
  emailLogo: 'Логотип для писем',
}

/**
 * Слоты, отсутствие которых — регресс при переезде контура на v2.
 *
 * Витрина берёт логотип и фавикон из ответа `brand` legacy **сегодня**
 * (Р-014). Релиз без них собирается — это контент, а не граница доступа, — но
 * сборка обязана сказать об этом вслух, иначе переезд отнимет у витрины
 * картинки молча.
 */
export const BRAND_ASSETS_SHOWN_TODAY: readonly BrandAssetSlot[] = ['logoLight', 'favicon']

/** Фирменный цвет в том же виде, в каком его отдаёт legacy: `#rrggbb`. */
export const BRAND_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Верхняя граница стартового демо-баланса.
 *
 * Существует не ради красоты формы. Число уезжает в кабинет и становится там
 * деньгами счёта; значение за пределами безопасного целого разбирается
 * успешно, а потом молча теряет точность — тот же класс, что `"NaN" → 0`.
 * Граница выбрана заведомо больше любого осмысленного демо-баланса
 * (10 млрд единиц валюты в центах) и заведомо меньше `Number.MAX_SAFE_INTEGER`.
 */
export const MAX_DEMO_START_BALANCE_CENTS = 1_000_000_000_000

/**
 * Валюта стартовой суммы и число её младших единиц (Р-293, Р-435, CMS-29).
 *
 * Сумма демо-счёта — денежная величина, пересекающая границу зон, а деньги
 * едут тройкой: сумма в наименьших единицах, код валюты, число знаков младшей
 * единицы (Р-293). До сегодня тройка была неполной — поле несло только число,
 * и совпадало оно с валютой счёта **случайно**: счёт открывался в долларах, у
 * которых младшая единица и есть цент. Для счёта в иене (0 знаков) или динаре
 * (3 знака) та же строка означала бы сумму в сто и в тысячу раз другую.
 *
 * Перечень закрытый, а не «любые три буквы»: с появлением числа знаков принять
 * незнакомый код значило бы завести сумму, которую нечем истолковать — тот же
 * урок, что у шины (Р-294). Число знаков хранится рядом с кодом, потому что
 * именно оно задаёт смысл записанного целого: «1000000» — это 10 000 единиц у
 * доллара, 1 000 000 у иены и 1 000 у динара.
 *
 * Расширяется по мере появления валют у площадки. Намеренно включены все три
 * разрядности (2, 0, 3): валюта с нулём и валюта с тремя — не теоретические,
 * и ветка «число знаков ≠ 2» обязана быть исполнимой, а не воображаемой.
 */
export const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  AUD: 2,
  CAD: 2,
  JPY: 0,
  BHD: 3,
  KWD: 3,
  TND: 3,
}

/** Код валюты в форме ISO 4217: ровно три заглавные латинские буквы. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

/** Известна ли валюта площадке. Незнакомая не заводится вовсе (Р-294). */
export function isKnownCurrency(code: unknown): code is string {
  return typeof code === 'string' && code.trim().toUpperCase() in CURRENCY_MINOR_UNITS
}

/**
 * Число знаков младшей единицы валюты — третий элемент денежной тройки.
 *
 * `null` для незнакомого кода: не «ноль знаков», а «истолковать нечем». Ноль —
 * законная разрядность (иена), и путать её с отказом нельзя, по тому же уроку,
 * что `null` против нуля у самой суммы.
 */
export function currencyMinorUnits(code: string | null | undefined): number | null {
  if (typeof code !== 'string') {
    return null
  }

  const units = CURRENCY_MINOR_UNITS[code.trim().toUpperCase()]

  return units === undefined ? null : units
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Читает слой со ссылкой на медиатеку.
 *
 * Payload отдаёт связь то идентификатором, то развёрнутым документом — в
 * зависимости от глубины выборки, — поэтому значение нормализуется, а не
 * проверяется на `typeof === 'string'`. Слой с выбранным режимом и пустой
 * ссылкой трактуется как `unset` по той же причине, что и у скаляров:
 * редактор, выбравший «переопределить» и не выбравший файл, почти наверняка
 * не закончил, а не решил стереть логотип бренда.
 */
export function readRelationLayer(raw: unknown): LayerState<string> {
  const group = asRecord(raw)
  const mode = group.mode

  if (mode !== 'override' && mode !== 'fork') {
    return { state: 'unset' }
  }

  const id = normalizeRelationId(group.value)

  if (id === null || id.trim() === '') {
    return { state: 'unset' }
  }

  return { state: mode, value: id.trim() }
}

/**
 * Читает слой целого числа — стартового демо-баланса в центах.
 *
 * Разбор и приведение здесь два разных барьера, и второй умеет испортить то,
 * что пропустил первый: `"NaN"` разбирается как число успешно, а приведение к
 * целому даёт ноль. Ноль — правдоподобный баланс, по нему не идут
 * разбираться. Поэтому негодное значение становится `unset` («значение не
 * задано»), а не нулём, и выше по цепочке ищется следующий слой.
 *
 * Отрицательные значения, дроби, бесконечности и величины за пределами
 * безопасного целого отвергаются здесь же — до того, как число станет
 * деньгами демо-счёта в кабинете.
 */
export function readMoneyLayer(raw: unknown): LayerState<number> {
  const group = asRecord(raw)
  const mode = group.mode

  if (mode !== 'override' && mode !== 'fork') {
    return { state: 'unset' }
  }

  const value = group.value

  if (typeof value !== 'number' && typeof value !== 'string') {
    return { state: 'unset' }
  }

  if (typeof value === 'string' && value.trim() === '') {
    return { state: 'unset' }
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { state: 'unset' }
  }

  if (parsed < 0 || parsed > MAX_DEMO_START_BALANCE_CENTS) {
    return { state: 'unset' }
  }

  return { state: mode, value: parsed }
}

/**
 * Читает слой с кодом валюты стартовой суммы (Р-293, Р-435, CMS-29).
 *
 * Код нормализуется к верхнему регистру и проверяется по закрытому перечню
 * площадки: незнакомый код становится `unset`, а не уезжает в снапшот. Это тот
 * же барьер, что у суммы, и по той же причине — негодное значение у одного
 * слоя не должно нулём или мусором перекрывать годное значение сверху по
 * цепочке. Полный известный перечень — единственный разрешённый вход: принять
 * «любые три буквы» значило бы завести валюту, у которой нечем взять число
 * знаков (Р-294).
 */
export function readCurrencyLayer(raw: unknown): LayerState<string> {
  const group = asRecord(raw)
  const mode = group.mode

  if (mode !== 'override' && mode !== 'fork') {
    return { state: 'unset' }
  }

  const value = typeof group.value === 'string' ? group.value.trim().toUpperCase() : ''

  if (value === '' || !(value in CURRENCY_MINOR_UNITS)) {
    return { state: 'unset' }
  }

  return { state: mode, value }
}

/**
 * Читает слой со списком социальных сетей.
 *
 * Ключ коллекции — название сети, значение — ссылка: так регион,
 * переопределяющий телеграм бренда, заменяет **его**, а не добавляет второй
 * пункт с тем же названием. Общий `readCollectionLayer` на это не годится —
 * он хранит только ключи.
 */
export function readSocialsLayer(raw: unknown): CollectionLayerState<string> {
  const group = asRecord(raw)
  const mode = group.mode

  if (mode !== 'extend' && mode !== 'fork') {
    return { state: 'unset' }
  }

  const rawItems = Array.isArray(group.items) ? group.items : []
  const items = new Map<string, string>()

  for (const entry of rawItems) {
    const record = asRecord(entry)
    const name = typeof record.name === 'string' ? record.name.trim().toLowerCase() : ''
    const url = typeof record.url === 'string' ? record.url.trim() : ''

    if (name === '' || url === '') {
      continue
    }

    items.set(name, url)
  }

  return { state: mode, items }
}

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

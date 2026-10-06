import { BRAND_ASSET_LABELS, BRAND_ASSETS_SHOWN_TODAY } from '@/platform'

import type { BrandSnapshot } from './types'
import type { Finding, Validator } from '@/platform'

/**
 * Проверка брендовых ассетов при сборке релиза (ТЗ 2.1, DEBT-014).
 *
 * Делит находки по тому, **кто платит за ошибку**:
 *
 * - ссылка на файл, который не отдать, — блокирующая. Витрина получила бы
 *   битую картинку там, где обещан логотип, и узнала бы об этом только от
 *   посетителя;
 * - отсутствие логотипа и фавикона — предупреждение. Релиз собрать можно,
 *   сайт без логотипа работает; но витрина берёт оба из ответа `brand`
 *   legacy сегодня, и переезд контура на v2 без них — регресс (Р-014).
 *   Молчать об этом нельзя: регресс, о котором не сказали, обнаруживают на
 *   проде.
 *
 * Блокировать отсутствие логотипа было бы неверно: гейт, который невозможно
 * удовлетворить на сайте без заведённой медиатеки, отключают — а мы уже
 * решили это однажды, отказавшись включать правило дисклеймера без текстов.
 */
export const brandAssetsValidator: Validator<{ readonly brand: BrandSnapshot | null }> = {
  name: 'brand-assets',
  description:
    'Брендовые ассеты разрешимы и отдаваемы: выбранный файл существует и имеет адрес, размеры и альтернативный текст (ТЗ 2.1).',

  run(input) {
    if (input.brand === null) {
      return [
        {
          validator: 'brand-assets',
          severity: 'blocking' as const,
          code: 'brand-not-collected',
          message:
            'Брендовые ассеты не собирались — результат проверки неизвестен. Сборка отклонена: раньше такой пропуск выглядел как чистый отчёт.',
        },
      ]
    }

    const findings: Finding[] = input.brand.findings.map((finding) => ({
      validator: 'brand-assets',
      severity: 'blocking' as const,
      code: finding.code,
      message: finding.message,
      location: finding.location,
    }))

    for (const slot of BRAND_ASSETS_SHOWN_TODAY) {
      if (input.brand.assets[slot] === null) {
        findings.push({
          validator: 'brand-assets',
          severity: 'warning' as const,
          code: 'brand-asset-absent',
          message: `${BRAND_ASSET_LABELS[slot]} не задан ни на сайте, ни выше по цепочке. Витрина берёт его сегодня из legacy — после переезда на v2 на этом месте не будет ничего.`,
          location: slot,
        })
      }
    }

    if (input.brand.primaryColor === null) {
      findings.push({
        validator: 'brand-assets',
        severity: 'warning' as const,
        code: 'brand-color-absent',
        message:
          'Фирменный цвет не задан ни на сайте, ни выше по цепочке. Legacy отдаёт его витрине сегодня; в ответе v2 на его месте будет null.',
        location: 'primaryColor',
      })
    }

    return findings
  },

  /**
   * Осмотренное — это **ссылки**, а не слоты.
   *
   * Шесть пустых слотов и шесть заполненных дали бы одинаковый `examined`,
   * если считать слоты, — то есть ровно ту неразличимость, ради устранения
   * которой охват и заведён. Ни одной ссылки — честное `empty`: материал
   * получен, и его действительно нет.
   */
  coverage(input) {
    if (input.brand === null) {
      return { kind: 'missing', reason: 'сборка не передала брендовые ассеты' }
    }

    if (input.brand.examinedReferences === 0) {
      return { kind: 'empty', reason: 'ни один слот брендовых ассетов не заполнен' }
    }

    return { kind: 'checked', examined: input.brand.examinedReferences }
  },
}

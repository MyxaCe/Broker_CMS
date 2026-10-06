import type { DisclaimersSnapshot } from './types'
import type { Finding, Validator } from '@/platform'

/**
 * Пятый комплаенс-ограничитель ТЗ 2.4, включённый блокирующим (CMS-07).
 *
 * До сегодняшнего дня правило существовало и не вызывалось ниоткуда
 * (BUG-010). Включать его было нельзя не из-за забывчивости: тексты
 * дисклеймеров негде было хранить, и блокирующее правило остановило бы
 * сборку **любой** страницы с калькулятором. Гейт, который невозможно
 * удовлетворить, отключают — и это было бы хуже невызываемого правила.
 *
 * Теперь он удовлетворим: текст есть — страница собирается, текста нет — не
 * собирается. Оба исхода проверены.
 */
export const disclaimersValidator: Validator<{ readonly disclaimers: DisclaimersSnapshot | null }> =
  {
    name: 'disclaimers',
    description:
      'Каждый дисклеймер, требуемый составом блоков страницы, имеет текст на её локали (ТЗ 2.4, Р-028).',

    run(input) {
      if (input.disclaimers === null) {
        return [
          {
            validator: 'disclaimers',
            severity: 'blocking' as const,
            code: 'disclaimers-not-collected',
            message:
              'Дисклеймеры не собирались — результат проверки неизвестен. Сборка отклонена: ровно так это правило и прожило месяц, выглядя пройденным.',
          },
        ]
      }

      return input.disclaimers.findings.map((finding): Finding => ({
        validator: 'disclaimers',
        severity: 'blocking' as const,
        code: finding.code,
        message: finding.message,
        location: finding.location,
      }))
    },

    /**
     * Осмотренное — пары «страница × требуемый ключ».
     *
     * Считать страницы было бы неверно вдвойне: страница без калькулятора
     * дисклеймеров не требует, и объявлять её осмотренной значило бы
     * завысить охват ровно тем материалом, на котором проверять нечего.
     */
    coverage(input) {
      if (input.disclaimers === null) {
        return { kind: 'missing', reason: 'сборка не передала дисклеймеры' }
      }

      if (input.disclaimers.examinedRequirements === 0) {
        return {
          kind: 'empty',
          reason: 'ни одна страница сайта не содержит блоков, требующих дисклеймера',
        }
      }

      return { kind: 'checked', examined: input.disclaimers.examinedRequirements }
    },
  }

import { CONTRACT_VERSION, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { DEFAULT_VARIANT } from '../cache-key'

import type { ReleaseSnapshot } from '../releases/snapshot'
import type { SiteConfigResponse } from '@/contracts'

/**
 * Сборка ответа доставки из снапшота релиза.
 *
 * Функция чистая: на вход — снапшот и запрошенные измерения, на выход —
 * ответ. Никаких обращений к базе здесь нет намеренно. Ответ обязан зависеть
 * **только** от релиза и кортежа измерений (ADR-0003): любое чтение живых
 * данных на этом шаге означало бы, что два запроса с одним `ETag` могут
 * вернуть разное.
 */

export interface ReleaseFacts {
  readonly number: number
  readonly builtAt: string
}

export class DeliveryAssemblyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliveryAssemblyError'
  }
}

export interface SiteConfigRequest {
  readonly locale?: string | null
  readonly variant?: string | null
}

/**
 * Разрешает запрошенную локаль.
 *
 * Отсутствие локали — это `defaultLocale`, а вот **неизвестная** локаль это
 * ошибка, а не молчаливый откат к умолчанию. Тихая подмена хуже отказа:
 * потребитель получает ответ, считает его немецким, а он английский, и
 * расхождение обнаруживается на сайте, а не в вызове.
 */
export function resolveLocale(snapshot: ReleaseSnapshot, requested: string | null | undefined) {
  const available = snapshot.settings.availableLocales
  const fallback = snapshot.settings.defaultLocale.value

  if (requested === null || requested === undefined || requested === '') {
    if (fallback === null) {
      throw new DeliveryAssemblyError('У релиза нет локали по умолчанию — отдавать нечего.')
    }

    return fallback
  }

  if (!available.includes(requested)) {
    throw new DeliveryAssemblyError(`Локаль "${requested}" у этого сайта не объявлена.`)
  }

  return requested
}

/**
 * Собирает ответ и **проверяет его схемой перед возвратом**.
 *
 * Проверка стоит здесь, а не в обработчике HTTP, чтобы её нельзя было обойти,
 * собрав ответ в другом месте: наружу уходит только то, что вернула эта
 * функция, и оно уже проверено.
 */
export function buildSiteConfigResponse(args: {
  readonly snapshot: ReleaseSnapshot
  readonly release: ReleaseFacts
  readonly request?: SiteConfigRequest
}): SiteConfigResponse {
  const { snapshot, release } = args
  const locale = resolveLocale(snapshot, args.request?.locale)
  const jurisdiction = snapshot.settings.jurisdiction.value
  const defaultLocale = snapshot.settings.defaultLocale.value

  if (jurisdiction === null || defaultLocale === null) {
    /**
     * Такой релиз не должен был собраться: обязательность проверяется
     * валидатором готовности сайта. Но собранные раньше релизы неизменяемы, и
     * отдать неполный ответ хуже, чем отказать.
     */
    throw new DeliveryAssemblyError(
      'В снапшоте релиза нет юрисдикции или локали по умолчанию — ответ был бы неполным.',
    )
  }

  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: snapshot.site.slug },
    release: { number: release.number, builtAt: release.builtAt },
    resolution: {
      locale,
      jurisdiction,
      /** До M5 механизма вариантов нет, но измерение в ответе присутствует (ADR-0003). */
      variant: args.request?.variant ?? DEFAULT_VARIANT,
    },
    settings: {
      defaultLocale,
      /**
       * Копия отсортирована ещё раз: снапшот сортирует при сборке, но релизы,
       * собранные до появления сортировки, остались бы с произвольным порядком,
       * а `ETag` обязан зависеть от содержимого, а не от порядка накопления.
       */
      availableLocales: [...snapshot.settings.availableLocales].sort(),
      jurisdiction,
    },
  }

  /**
   * Провенанс (`source` у каждого разрешённого значения) наружу не выходит:
   * он раскрывает структуру наследования тенантов — идентификаторы бренда и
   * региона, о существовании которых потребитель знать не должен. Схема
   * запрещает лишние поля, поэтому забыть его отфильтровать невозможно.
   */
  return validateOutgoing<SiteConfigResponse>(SCHEMA_IDS.siteConfig, payload)
}

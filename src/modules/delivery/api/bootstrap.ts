import { CONTRACT_VERSION, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { DEFAULT_VARIANT } from '../cache-key'

import { DeliveryAssemblyError, resolveLocale } from './site-config'

import type { ReleaseFacts, SiteConfigRequest } from './site-config'
import type { ReleaseSnapshot } from '../releases/snapshot'
import type { BootstrapResponse, GlobalAreaResponse, NavItemResponse } from '@/contracts'

/**
 * Стартовый набор сайта (ТЗ разд. 3: `bootstrap`).
 *
 * Токены темы, навигация и глобальные области одним ответом. Раздельные
 * запросы означали бы, что шапка приезжает отдельно от темы, и страница
 * успевает мигнуть чужим оформлением — на сайте брокера это выглядит как сбой.
 *
 * Функция чистая: всё берётся из снапшота релиза. Ни одного обращения к базе
 * здесь нет — иначе два ответа с одним `ETag` могли бы различаться.
 */
export function buildBootstrapResponse(args: {
  readonly snapshot: ReleaseSnapshot
  readonly release: ReleaseFacts
  readonly request?: SiteConfigRequest
}): BootstrapResponse {
  const { snapshot, release } = args
  const locale = resolveLocale(snapshot, args.request?.locale)
  const jurisdiction = snapshot.settings.jurisdiction.value

  if (jurisdiction === null) {
    throw new DeliveryAssemblyError('В снапшоте релиза нет юрисдикции — ответ был бы неполным.')
  }

  const navigation: Record<string, readonly NavItemResponse[]> = {}

  for (const menu of snapshot.structure.navigation) {
    if (menu.locale === locale) {
      navigation[menu.placement] = menu.items as readonly NavItemResponse[]
    }
  }

  const globalAreas: Record<string, GlobalAreaResponse> = {}

  for (const area of snapshot.structure.globalAreas) {
    if (area.locale !== locale) {
      continue
    }

    globalAreas[area.kind] = {
      /**
       * Дерево блоков области отдаётся как есть: секции в нём уже раскрыты при
       * сборке. Массив на месте пустого значения, а не `null`, — потребителю
       * незачем различать «нет области» и «область без блоков», раз ключа с
       * отсутствующей областью в ответе всё равно не будет.
       */
      blocks: Array.isArray(area.blocks) ? (area.blocks as { readonly type: string }[]) : [],
      riskWarning: area.riskWarning,
      jurisdictions: area.jurisdictions,
    }
  }

  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: snapshot.site.slug },
    release: { number: release.number, builtAt: release.builtAt },
    resolution: {
      locale,
      jurisdiction,
      variant: args.request?.variant ?? DEFAULT_VARIANT,
    },
    theme: snapshot.tokens,
    navigation,
    globalAreas,
  }

  return validateOutgoing<BootstrapResponse>(SCHEMA_IDS.bootstrap, payload)
}

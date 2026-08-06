import { resolveNavTree, validateNavTree } from '../navigation/tree'
import { expandSections, resolveSections } from '../sections/resolve'

import { pickNearest } from './inherit'

import type { SectionRecord } from '../sections/resolve'
import type {
  SnapshotGlobalArea,
  SnapshotNavigation,
  StructureFinding,
  StructureSnapshot,
} from './types'

/**
 * Сборка структуры сайта из записей (ТЗ 2.2).
 *
 * Функция чистая: базы здесь нет. Это единственный способ покрыть тестами всё
 * дерево случаев наследования — те, что в живой системе воспроизводятся раз в
 * полгода, и те, что воспроизводятся только вместе с удалением страницы.
 */

export interface NavigationRecord {
  readonly placement: string
  readonly locale: string
  readonly ownerId: string
  readonly isActive: boolean
  readonly items: unknown
}

export interface GlobalAreaRecord {
  readonly kind: string
  readonly locale: string
  readonly ownerId: string
  readonly isActive: boolean
  readonly blocks: unknown
  readonly riskWarning: { readonly text: string; readonly lossPercentage: number | null } | null
  readonly jurisdictions: readonly string[]
}

export interface ComposeStructureArgs {
  /** Цепочка от корня к листу: `[brandId, regionId, siteId]`. */
  readonly chainIds: readonly string[]
  readonly locales: readonly string[]
  readonly sections: readonly SectionRecord[]
  readonly navigations: readonly NavigationRecord[]
  readonly globalAreas: readonly GlobalAreaRecord[]
  /** Опубликованные страницы сайта: язык → идентификатор → путь. */
  readonly pagePaths: ReadonlyMap<string, ReadonlyMap<string, string>>
}

export function composeStructure(args: ComposeStructureArgs): StructureSnapshot {
  const navigation: SnapshotNavigation[] = []
  const globalAreas: SnapshotGlobalArea[] = []
  const findings: StructureFinding[] = []

  /**
   * Сортировка локалей и ключей обязательна: снапшот участвует в отпечатке
   * содержимого, и порядок обхода не должен на него влиять — иначе `ETag`
   * меняется при неизменных данных.
   */
  for (const locale of [...args.locales].sort()) {
    const pages = args.pagePaths.get(locale) ?? new Map<string, string>()
    const sections = resolveSections({
      chainIds: args.chainIds,
      records: args.sections,
      locale,
    })

    const menus = pickNearest({
      chainIds: args.chainIds,
      items: args.navigations.filter((record) => record.locale === locale),
      keyOf: (record) => record.placement,
      ownerOf: (record) => record.ownerId,
      isActive: (record) => record.isActive,
    })

    for (const placement of [...menus.keys()].sort()) {
      const record = menus.get(placement)!.item

      /**
       * Ссылки проверяются здесь, а не при сохранении меню: при сохранении
       * список страниц ещё меняется — редактор вправе собрать меню раньше
       * страниц. Момент, когда состав страниц окончателен, — это сборка релиза.
       */
      for (const issue of validateNavTree(record.items, { knownPages: new Set(pages.keys()) })) {
        findings.push({
          code: `nav-${issue.code}`,
          message: issue.message,
          location: `${locale}/${placement}/${issue.path}`,
          /**
           * Битая ссылка не блокирует релиз: пункт исключается, меню остаётся
           * связным, и сайт работает. Блокировать публикацию всего сайта из-за
           * одного пункта значило бы, что снятие страницы с публикации
           * останавливает выкатку — а это обычное редакторское действие.
           *
           * Всё остальное в меню — форма дерева, и она обязана быть верной.
           */
          severity: issue.code === 'dangling-page' ? 'warning' : 'blocking',
        })
      }

      navigation.push({
        locale,
        placement,
        items: resolveNavTree(record.items, pages),
      })
    }

    const areas = pickNearest({
      chainIds: args.chainIds,
      items: args.globalAreas.filter((record) => record.locale === locale),
      keyOf: (record) => record.kind,
      ownerOf: (record) => record.ownerId,
      isActive: (record) => record.isActive,
    })

    for (const kind of [...areas.keys()].sort()) {
      const record = areas.get(kind)!.item
      const expanded = expandSections(record.blocks, sections)

      for (const issue of expanded.issues) {
        findings.push({
          code: `section-${issue.code}`,
          message: issue.message,
          location: `${locale}/${kind}/${issue.path}`,
          /**
           * Дыра в области — блокирующая: подвал без блока с реквизитами
           * выглядит целым, и заметить пропажу можно только на витрине.
           */
          severity: 'blocking',
        })
      }

      globalAreas.push({
        locale,
        kind,
        blocks: expanded.blocks,
        riskWarning: record.riskWarning,
        jurisdictions: [...record.jurisdictions].sort(),
      })
    }
  }

  return { navigation, globalAreas, findings }
}

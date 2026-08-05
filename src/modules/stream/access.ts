import { createTenantAccess, isCrossTenantActor, toActor } from '@/platform'

import { publishedWhere } from './visibility'

import type { Access, Where } from 'payload'

/**
 * Правила доступа к коллекциям потока (ТЗ 1.3, ADR-0021).
 *
 * Два разных читателя с разными правилами:
 *
 *  · **сотрудник** — видит свои тенанты целиком, включая черновики: иначе
 *    редактировать нечего;
 *  · **доставка** (запрос без учётной записи) — видит только опубликованное и
 *    только то, чьё время наступило.
 *
 * Черновик невидим снаружи **по построению**: условие уходит в SQL, поэтому
 * его нельзя забыть добавить. Помощника вида `readPublished()` можно не
 * позвать; правило доступа применяется само.
 */

/**
 * Чтение записей потока.
 *
 * Порядок проверок значим: отсутствие пользователя — это доставка, а не отказ.
 * Обычное для нас fail-closed «нет пользователя → нельзя» здесь дало бы пустую
 * витрину; закрытость обеспечивается не отказом, а сужением до опубликованного.
 */
export function createStreamReadAccess(options: { siteField: string }): Access {
  const tenantAccess = createTenantAccess({ field: options.siteField })

  return async (args) => {
    const actor = toActor(args.req.user)

    if (actor === null) {
      return publishedWhere(new Date())
    }

    /**
     * Отключённая учётная запись не должна видеть больше, чем аноним. Она и не
     * увидит: `createTenantAccess` откажет — но тогда редактор с отозванным
     * доступом получил бы отказ там, где витрина получает данные. Это верно:
     * отзыв доступа означает отзыв доступа, а не понижение до анонима.
     */
    return tenantAccess(args)
  }
}

/**
 * Изменение записей потока — только сотрудник со своими тенантами.
 *
 * Здесь fail-closed в обычном виде: нет пользователя — нет записи.
 */
export function createStreamWriteAccess(options: { siteField: string }): Access {
  const tenantAccess = createTenantAccess({ field: options.siteField })

  return async (args) => {
    if (toActor(args.req.user) === null) {
      return false
    }

    return tenantAccess(args)
  }
}

/**
 * Удаление записей потока.
 *
 * Разрешено только кросс-тенантной роли: у опубликованной новости есть
 * читатели и ссылки, и её исчезновение — это не правка, а событие. Обычный
 * путь снятия с витрины — состояние «в архиве» либо `unpublishAt`, и он не
 * теряет историю.
 */
export const streamDeleteAccess: Access = ({ req }) => isCrossTenantActor(req.user)

/** Сводит несколько ограничений в одно. Пустой список означает «без ограничений». */
export function andWhere(...conditions: (Where | null)[]): Where | null {
  const present = conditions.filter((condition): condition is Where => condition !== null)

  if (present.length === 0) {
    return null
  }

  return present.length === 1 ? present[0]! : { and: present }
}

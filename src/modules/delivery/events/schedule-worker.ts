import {
  changedTagsFor,
  SCHEDULED_COLLECTIONS,
  transitionWindow,
  tenantOfField,
} from '@/modules/stream'
import { createLogger } from '@/platform'

import { enqueueEvent } from './enqueue'
import { CMS_EVENTS } from './envelope'

import type { PendingTransition, ScheduledCollection, TransitionKind } from '@/modules/stream'
import type { Payload } from 'payload'

/**
 * Процесс, объявляющий наступившие переходы (ТЗ 1.2).
 *
 * Он **не** делает материалы видимыми и невидимыми: это следствие времени и
 * правила доступа, и оно работает независимо от планировщика. Здесь только
 * побочный эффект перехода — событие, по которому потребители сбрасывают кеш.
 *
 * Практическое следствие: остановленный планировщик не роняет корректность.
 * Витрина обновится не позже, чем истечёт срок жизни её ответа; планировщик
 * лишь делает это сразу.
 */

export interface ScheduleWorkerOptions {
  readonly payload: Payload
  /** С какого момента искать переходы. Обычно — конец предыдущего прохода. */
  readonly since: Date
  readonly until?: Date
  readonly log?: {
    info(fields: Record<string, unknown>, message: string): void
    error(fields: Record<string, unknown>, message: string): void
  }
}

export interface ScheduleWorkerResult {
  readonly announced: number
  readonly until: Date
}

/**
 * Один проход: находит переходы в окне и ставит события в outbox.
 *
 * Событие ставится **транзакционно вместе с ничем** — записи потока при этом
 * не меняются. Это осознанно: менять запись ради отметки «о переходе сообщили»
 * значило бы писать в базу на каждом такте планировщика и портить журнал
 * аудита служебными правками. Границей служит окно времени, а не флаг.
 */
export async function runScheduleTick(
  options: ScheduleWorkerOptions,
): Promise<ScheduleWorkerResult> {
  const log = options.log ?? createLogger({ component: 'stream-scheduler' })
  const until = options.until ?? new Date()
  const window = transitionWindow({ since: options.since, until })

  const transitions: PendingTransition[] = []

  for (const collection of SCHEDULED_COLLECTIONS) {
    transitions.push(
      ...(await collectTransitions(
        options.payload,
        collection,
        'published',
        window.publishedWhere,
      )),
    )
    transitions.push(
      ...(await collectTransitions(options.payload, collection, 'expired', window.expiredWhere)),
    )
  }

  for (const transition of transitions) {
    await enqueueEvent({
      payload: options.payload,
      event:
        transition.kind === 'published' ? CMS_EVENTS.streamPublished : CMS_EVENTS.streamExpired,
      tenantId: transition.siteId,
      body: {
        site: transition.siteSlug,
        siteId: transition.siteId,
        collection: transition.collection,
        slug: transition.slug,
        occurredAt: transition.at,
        changedTags: changedTagsFor(transition),
      },
    })
  }

  if (transitions.length > 0) {
    log.info(
      { announced: transitions.length, until: until.toISOString() },
      'Объявлены переходы потока',
    )
  }

  return { announced: transitions.length, until }
}

async function collectTransitions(
  payload: Payload,
  collection: ScheduledCollection,
  kind: TransitionKind,
  where: Record<string, unknown>,
): Promise<PendingTransition[]> {
  const found = await payload.find({
    collection,
    where: where as never,
    pagination: false,
    limit: 500,
    depth: 1,
    /**
     * Планировщик — служебный процесс: ему нужно видеть и то, что ещё не
     * видно снаружи, иначе о наступившей публикации некому будет сообщить.
     * Результат наружу не отдаётся, только в событие.
     */
    overrideAccess: true,
  })

  return found.docs.map((doc) => {
    const record = doc as unknown as Record<string, unknown>
    const site = tenantOfField(record, 'site')

    return {
      collection,
      id: String(record.id),
      siteId: site.id ?? '',
      siteSlug: site.slug ?? '',
      slug: typeof record.slug === 'string' ? record.slug : '',
      kind,
      at: String(kind === 'published' ? record.publishAt : record.unpublishAt),
    }
  })
}

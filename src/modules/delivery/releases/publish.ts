import { CMS_EVENTS } from '../events/envelope'
import { enqueueEvent } from '../events/enqueue'

import type { ChannelName } from './channels.collection'
import type { Payload, PayloadRequest } from 'payload'

/**
 * Публикация и откат (ТЗ часть 3).
 *
 * Обе операции — это одно и то же действие: переключение указателя канала.
 * Разными их делает только направление, и в журнале с событиями они обязаны
 * различаться, иначе «откатились» и «выпустили» становятся неотличимы.
 *
 * Переключение и событие о нём выполняются **в одной транзакции**: не бывает
 * публикации без события и события без публикации.
 */

export interface SwitchChannelArgs {
  readonly payload: Payload
  readonly siteId: string
  readonly siteSlug: string
  readonly channel: ChannelName
  readonly releaseId: string
  readonly releaseNumber: number
  /** Публикация или возврат на предыдущий релиз. */
  readonly intent: 'publish' | 'rollback'
  readonly actor?: { readonly id: string | null; readonly email: string | null }
  readonly req?: PayloadRequest
}

export interface SwitchChannelResult {
  readonly channelId: number | string
  readonly previousReleaseId: string | null
  readonly previousReleaseNumber: number | null
  readonly eventId: string
}

export async function switchChannel(args: SwitchChannelArgs): Promise<SwitchChannelResult> {
  const { payload } = args

  const existing = await payload.find({
    collection: 'channels',
    where: {
      and: [{ siteId: { equals: args.siteId } }, { name: { equals: args.channel } }],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
  })

  const current = existing.docs[0] as unknown as Record<string, unknown> | undefined

  const previousReleaseId =
    typeof current?.releaseId === 'string' && current.releaseId !== '' ? current.releaseId : null
  const previousReleaseNumber =
    typeof current?.releaseNumber === 'number' ? current.releaseNumber : null

  const data = {
    siteId: args.siteId,
    siteSlug: args.siteSlug,
    name: args.channel,
    label: `${args.siteSlug} ${args.channel}`,
    releaseId: args.releaseId,
    releaseNumber: args.releaseNumber,
    switchedAt: new Date().toISOString(),
    switchedById: args.actor?.id ?? null,
    switchedByEmail: args.actor?.email ?? null,
  }

  const channel = current
    ? await payload.update({
        collection: 'channels',
        id: current.id as number,
        overrideAccess: true,
        ...(args.req ? { req: args.req } : {}),
        data: data as never,
      })
    : await payload.create({
        collection: 'channels',
        overrideAccess: true,
        ...(args.req ? { req: args.req } : {}),
        data: data as never,
      })

  const envelope = await enqueueEvent({
    payload,
    event: args.intent === 'rollback' ? CMS_EVENTS.releaseRolledBack : CMS_EVENTS.releasePublished,
    tenantId: args.siteId,
    ...(args.req ? { req: args.req } : {}),
    body: {
      site: args.siteSlug,
      siteId: args.siteId,
      channel: args.channel,
      releaseId: args.releaseId,
      releaseNumber: args.releaseNumber,
      previousReleaseId,
      previousReleaseNumber,
      /**
       * Потребитель сбрасывает кеш по этим меткам. Пока метка одна — сайт
       * целиком; точечная инвалидация появится вместе с моделью страниц.
       */
      changedTags: [`site:${args.siteSlug}`],
    },
  })

  return {
    channelId: channel.id,
    previousReleaseId,
    previousReleaseNumber,
    eventId: envelope.event_id,
  }
}

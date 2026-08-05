import { describe, expect, it } from 'vitest'

import { MappingError } from './mapper'
import { toPromoItem } from './promo-board'
import { toVideoFeedItem } from './video-item'

const NOW = new Date('2026-08-05T12:00:00.000Z')

describe('элемент ленты видео', () => {
  const doc = {
    id: 1,
    slug: 'razbor-rynka',
    title: 'Разбор рынка',
    description: 'Еженедельный обзор',
    publishAt: '2026-08-05T09:00:00.000Z',
    provider: 'youtube',
    externalId: 'abc123',
    startsAt: null,
    endsAt: null,
    speakers: [{ slug: 'ivanov', title: 'Иванов' }],
    tags: [{ slug: 'rates', title: 'Ставки' }],
  }

  it('собирается из полной записи', () => {
    expect(toVideoFeedItem(doc, NOW)).toMatchObject({
      slug: 'razbor-rynka',
      provider: 'youtube',
      externalId: 'abc123',
      speakers: [{ slug: 'ivanov', title: 'Иванов' }],
      tags: ['rates'],
    })
  })

  it('состояние эфира вычисляется, а не читается из записи', () => {
    const live = toVideoFeedItem(
      { ...doc, startsAt: '2026-08-05T11:00:00.000Z', endsAt: '2026-08-05T13:00:00.000Z' },
      NOW,
    )

    expect(live.broadcast.state).toBe('live')
    expect(doc).not.toHaveProperty('broadcastState')
  })

  /**
   * Пустой проигрыватель на витрине увидит читатель, а не редактор. Запись
   * исключается и попадает в алерт.
   */
  it('ролик без идентификатора и без файла исключается', () => {
    expect(() => toVideoFeedItem({ ...doc, externalId: null }, NOW)).toThrow(MappingError)
  })

  it('собственное хранилище опознаётся по файлу', () => {
    const item = toVideoFeedItem(
      { ...doc, provider: 'self-hosted', externalId: null, media: { url: 'https://a/b.mp4' } },
      NOW,
    )

    expect(item.fileUrl).toBe('https://a/b.mp4')
  })

  it.each(['slug', 'title', 'publishAt', 'provider'])('без поля %s запись непригодна', (field) => {
    expect(() => toVideoFeedItem({ ...doc, [field]: undefined }, NOW)).toThrow(MappingError)
  })

  it('обложка без альтернативного текста не отдаётся', () => {
    const item = toVideoFeedItem({ ...doc, poster: { url: 'https://a/b.png' } }, NOW)

    expect(item.poster).toBeNull()
  })
})

describe('элемент промо-доски', () => {
  const doc = {
    id: 1,
    slug: 'letnyaya-aktsiya',
    title: 'Летняя акция',
    badge: 'Новое',
    description: 'Описание',
    terms: 'Условия акции',
    ctaLabel: 'Открыть счёт',
    ctaHref: 'https://example.test/open',
    jurisdictions: [{ code: 'eu-mifid' }],
    priority: 10,
    featured: true,
  }

  it('собирается из полной записи', () => {
    expect(toPromoItem(doc)).toMatchObject({
      slug: 'letnyaya-aktsiya',
      terms: 'Условия акции',
      cta: { label: 'Открыть счёт', href: 'https://example.test/open' },
      jurisdictions: ['eu-mifid'],
      priority: 10,
    })
  })

  /**
   * Предложение без условий в регулируемом домене — нарушение. Лучше его
   * отсутствие на витрине, чем оно же без условий.
   */
  it('промо без условий исключается', () => {
    expect(() => toPromoItem({ ...doc, terms: undefined })).toThrow(MappingError)
    expect(() => toPromoItem({ ...doc, terms: '   ' })).toThrow(MappingError)
  })

  /** Половина кнопки хуже её отсутствия: по ней кликают. */
  it.each([
    ['без адреса', { ctaHref: undefined }],
    ['без надписи', { ctaLabel: undefined }],
  ])('кнопка %s исключает промо', (_name, overrides) => {
    expect(() => toPromoItem({ ...doc, ...overrides })).toThrow(MappingError)
  })

  it('промо без кнопки целиком допустимо', () => {
    const item = toPromoItem({ ...doc, ctaLabel: undefined, ctaHref: undefined })

    expect(item.cta).toBeNull()
  })

  it('пустой список юрисдикций означает «во всех»', () => {
    expect(toPromoItem({ ...doc, jurisdictions: [] }).jurisdictions).toEqual([])
  })

  it('приоритет по умолчанию нулевой', () => {
    expect(toPromoItem({ ...doc, priority: undefined }).priority).toBe(0)
  })
})

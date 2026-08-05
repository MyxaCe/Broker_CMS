import { describe, expect, it } from 'vitest'

import { changedTagsFor, SCHEDULED_COLLECTIONS, transitionWindow } from './transitions'

import type { PendingTransition } from './transitions'

const SINCE = new Date('2026-08-05T12:00:00.000Z')
const UNTIL = new Date('2026-08-05T12:00:30.000Z')

describe('окно переходов', () => {
  /**
   * Полуоткрытый промежуток: соседние проходы не должны обработать один и тот
   * же переход дважды. Верхняя граница включается, нижняя — нет.
   */
  it('нижняя граница исключена, верхняя включена', () => {
    const window = transitionWindow({ since: SINCE, until: UNTIL })
    const dump = JSON.stringify(window.publishedWhere)

    expect(dump).toContain('greater_than')
    expect(dump).not.toContain('greater_than_equal')
    expect(dump).toContain('less_than_equal')
  })

  it('публикации ищутся по дате публикации, снятия — по дате снятия', () => {
    const window = transitionWindow({ since: SINCE, until: UNTIL })

    expect(JSON.stringify(window.publishedWhere)).toContain('publishAt')
    expect(JSON.stringify(window.expiredWhere)).toContain('unpublishAt')
  })

  /** Черновик не переходит: он не станет видимым сам по себе. */
  it('оба окна ограничены опубликованным состоянием', () => {
    const window = transitionWindow({ since: SINCE, until: UNTIL })

    expect(JSON.stringify(window.publishedWhere)).toContain('published')
    expect(JSON.stringify(window.expiredWhere)).toContain('published')
  })

  it('границы окна попадают в условие как есть', () => {
    const dump = JSON.stringify(transitionWindow({ since: SINCE, until: UNTIL }).publishedWhere)

    expect(dump).toContain(SINCE.toISOString())
    expect(dump).toContain(UNTIL.toISOString())
  })
})

describe('перечень коллекций с переходами', () => {
  /**
   * Явный, а не «все коллекции с полем publishAt»: неявный список молча
   * включил бы в себя всё, что случайно назвало поле так же.
   */
  it('содержит все сущности потока с временем жизни', () => {
    expect([...SCHEDULED_COLLECTIONS]).toEqual(['articles', 'videos', 'promos'])
  })
})

describe('метки сброса кеша', () => {
  const transition: PendingTransition = {
    collection: 'promos',
    id: '7',
    siteId: '10',
    siteSlug: 'apex-de',
    slug: 'letnyaya-aktsiya',
    kind: 'expired',
    at: '2026-08-05T12:00:10.000Z',
  }

  /**
   * Метка шире необходимого — это лишний сброс кеша; уже необходимого —
   * устаревшая витрина. Выбор очевиден, поэтому меток две: широкая и точная.
   */
  it('включают и сайт целиком, и конкретную запись', () => {
    expect(changedTagsFor(transition)).toEqual(['site:apex-de', 'promos:letnyaya-aktsiya'])
  })
})

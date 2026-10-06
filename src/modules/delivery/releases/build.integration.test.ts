import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildSiteConfigResponse } from '../api/site-config'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Сборка релиза (ТЗ часть 3, критерий приёмки разд. 11).
 *
 * Проверяемое утверждение: **редактор не может опубликовать состояние,
 * нарушающее требования** — сборка отклоняет его с внятным отчётом, а не
 * выпускает наружу.
 */

let payload: Payload
let brandId: number | string
let readySiteId: number | string
let brokenSiteId: number | string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Сборка — бренд',
      slug: `build-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }, { code: 'de' }] },
      defaultLocale: { mode: 'override', value: 'de' },
    } as never,
    overrideAccess: true,
  })

  brandId = brand.id

  /**
   * Полоса риск-предупреждения на каждую локаль бренда.
   *
   * Появилась вместе с комплаенс-гейтом (ТЗ 2.4) и уронила этот тест — то есть
   * гейт сработал ровно так, как задуман: сайт в регулируемой юрисдикции без
   * предупреждения не собирается. Фикстура приведена к реальности, а не гейт
   * ослаблен.
   */
  for (const locale of ['en', 'de']) {
    await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: `Предупреждение (${locale})`,
        kind: 'risk-warning',
        owner: brandId,
        locale,
        isActive: true,
        riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
      } as never,
    })
  }

  const ready = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Сборка — готовый сайт',
      slug: `build-ready-${stamp}`,
      kind: 'site',
      parent: brandId,
    } as never,
    overrideAccess: true,
  })

  readySiteId = ready.id

  /**
   * «Сломанный» сайт создаётся под брендом без настроек: сохранить его можно,
   * потому что бренд-родитель настроек не даёт, — а вот собрать релиз нельзя.
   */
  const emptyBrand = await payload.create({
    collection: 'tenants',
    data: { name: 'Пустой бренд', slug: `build-empty-${stamp}`, kind: 'brand' } as never,
    overrideAccess: true,
  })

  brokenSiteId = emptyBrand.id
})

describe('успешная сборка', () => {
  it('сайт с разрешёнными настройками собирается', async () => {
    const result = await buildRelease({ payload, siteId: readySiteId })

    expect(result.status).toBe('ready')
    expect(result.report.passed).toBe(true)
    expect(result.report.blocking).toEqual([])
  })

  it('снапшот содержит унаследованные настройки', async () => {
    const result = await buildRelease({ payload, siteId: readySiteId })

    expect(result.snapshot.settings.jurisdiction.value).toBe('eu-mifid')
    expect(result.snapshot.settings.availableLocales).toEqual(['de', 'en'])
    expect(result.snapshot.settings.defaultLocale.value).toBe('de')
  })

  /**
   * Цепочка «карточка доступа → снапшот релиза → ответ выдачи» (Р-024, Р-026).
   *
   * Покрытие единицы не является покрытием пути: правило включения проверено
   * своими тестами, но между ним и витриной три перехода, и дефект живёт
   * именно в них.
   */
  it('разрешённые инструменты доезжают из карточки до ответа выдачи символами', async () => {
    const syncedAt = new Date().toISOString()

    /**
     * Символ помечен тем же штампом, что и тенанты файла.
     *
     * Постоянный `BUILDUSD` делал тест одноразовым: `symbol` уникален, база
     * между прогонами не стирается, и второй прогон падал на фикстуре, а не
     * на проверяемом. Проверка, которую нельзя повторить, не проверка —
     * красный цвет здесь означал бы «тест уже запускали», а не «сборка
     * сломана».
     */
    const symbol = `BUILD${stamp}USD`

    await payload.create({
      collection: 'mds-instruments',
      overrideAccess: true,
      data: { symbol, name: 'Фикстура', quoted: true, syncedAt } as never,
    })

    await payload.create({
      collection: 'mds-universe-syncs',
      overrideAccess: true,
      data: {
        startedAt: syncedAt,
        finishedAt: syncedAt,
        outcome: 'fetched',
        instruments: 1,
        quoted: 1,
      } as never,
    })

    await payload.create({
      collection: 'instrument-access',
      overrideAccess: true,
      data: { site: readySiteId, instruments: [{ symbol }] } as never,
    })

    const result = await buildRelease({ payload, siteId: readySiteId })

    expect(result.snapshot.instruments).toEqual({
      symbols: [symbol],
      configured: true,
      confirmedUnquoted: [],
    })

    const response = buildSiteConfigResponse({
      snapshot: result.snapshot,
      release: { number: result.number, builtAt: new Date().toISOString() },
    })

    // Символ, а не числовой id: нумерация — внутренняя деталь терминала (Р-024).
    expect(response.settings.instruments).toEqual([symbol])
  })

  /**
   * Регресс пишется на состоянии, в котором дефект жил. Релиз, собранный до
   * появления поля, снапшота с инструментами не имеет — и выдача обязана
   * отдать пустой список, то есть «ничего не разрешено», а не уронить ответ и
   * не отдать поле отсутствующим.
   */
  it('снапшот без поля инструментов даёт пустой список, а не отсутствие поля', () => {
    const legacySnapshot = {
      schemaVersion: 'snapshot-v1',
      site: { id: '1', slug: 'legacy-site', kind: 'site' as const },
      settings: {
        jurisdiction: { value: 'eu-mifid', source: '1' },
        defaultLocale: { value: 'de', source: '1' },
        availableLocales: ['de'],
      },
    } as never

    const response = buildSiteConfigResponse({
      snapshot: legacySnapshot,
      release: { number: 1, builtAt: new Date().toISOString() },
    })

    expect(response.settings.instruments).toEqual([])
  })

  it('снапшот и отпечаток сохранены в записи релиза', async () => {
    const result = await buildRelease({ payload, siteId: readySiteId })

    const release = await payload.findByID({
      collection: 'releases',
      id: result.releaseId,
      overrideAccess: true,
    })

    expect(release.status).toBe('ready')
    expect(release.contentHash).toBeTruthy()
    expect(JSON.stringify(release.snapshot)).toContain('eu-mifid')
  })

  it('одинаковое состояние даёт одинаковый отпечаток — ETag не «дрожит»', async () => {
    const first = await buildRelease({ payload, siteId: readySiteId })
    const second = await buildRelease({ payload, siteId: readySiteId })

    const [a, b] = await Promise.all(
      [first.releaseId, second.releaseId].map((id) =>
        payload.findByID({ collection: 'releases', id, overrideAccess: true }),
      ),
    )

    expect(a?.contentHash).toBe(b?.contentHash)
  })

  it('номера растут и не переиспользуются', async () => {
    const first = await buildRelease({ payload, siteId: readySiteId })
    const second = await buildRelease({ payload, siteId: readySiteId })

    expect(second.number).toBe(first.number + 1)
  })
})

describe('сборка отклоняется, а не выпускает нарушение', () => {
  it('сайт без юрисдикции и локалей не собирается', async () => {
    const result = await buildRelease({ payload, siteId: brokenSiteId })

    expect(result.status).toBe('failed')
    expect(result.report.passed).toBe(false)
  })

  it('отчёт объясняет причину, а не просто отказывает', async () => {
    const result = await buildRelease({ payload, siteId: brokenSiteId })
    const codes = result.report.blocking.map((finding) => finding.code)

    // Бренд — не сайт: это первое, что должно быть названо.
    expect(codes).toContain('not-a-site')
  })

  it('у проваленной сборки снапшот не сохраняется, а отчёт сохраняется', async () => {
    const result = await buildRelease({ payload, siteId: brokenSiteId })

    const release = await payload.findByID({
      collection: 'releases',
      id: result.releaseId,
      overrideAccess: true,
    })

    expect(release.status).toBe('failed')
    expect(release.snapshot).toBeFalsy()
    expect(JSON.stringify(release.validationReport)).toContain('not-a-site')
  })

  it('номер проваленной сборки занят навсегда', async () => {
    const failed = await buildRelease({ payload, siteId: brokenSiteId })
    const next = await buildRelease({ payload, siteId: brokenSiteId })

    expect(next.number).toBe(failed.number + 1)
  })
})

describe('одновременные сборки', () => {
  /**
   * Две сборки читают максимальный номер одновременно, получают одинаковое
   * значение и пытаются его записать. Уникальность пары «сайт + номер» в БД
   * превращает эту гонку в честную ошибку у второй, а не в двойника.
   */
  it('две одновременные сборки не создают релизы с одним номером', async () => {
    const site = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Гонка',
        slug: `build-race-${stamp}`,
        kind: 'site',
        parent: brandId,
      } as never,
      overrideAccess: true,
    })

    const results = await Promise.allSettled([
      buildRelease({ payload, siteId: site.id }),
      buildRelease({ payload, siteId: site.id }),
    ])

    const succeeded = results.filter((result) => result.status === 'fulfilled')

    const releases = await payload.find({
      collection: 'releases',
      where: { siteId: { equals: String(site.id) } },
      pagination: false,
      overrideAccess: true,
    })

    const numbers = releases.docs.map((doc) => Number(doc.number))

    expect(new Set(numbers).size, 'номера релизов повторились').toBe(numbers.length)
    expect(succeeded.length).toBeGreaterThanOrEqual(1)
  })
})

describe('сборка попадает в журнал аудита', () => {
  it('создание и завершение релиза зафиксированы', async () => {
    const result = await buildRelease({ payload, siteId: readySiteId })

    const events = await payload.find({
      collection: 'audit-events',
      where: {
        and: [
          { targetCollection: { equals: 'releases' } },
          { targetId: { equals: String(result.releaseId) } },
        ],
      },
      pagination: false,
      overrideAccess: true,
      sort: 'createdAt',
    })

    expect(events.docs.length).toBeGreaterThanOrEqual(2)
    expect(events.docs.map((doc) => doc.action)).toContain('create')
    expect(events.docs.map((doc) => doc.action)).toContain('update')
  })
})

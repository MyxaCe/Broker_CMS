import { describe, expect, it } from 'vitest'

import {
  BRAND_ASSET_SLOTS,
  MAX_DEMO_START_BALANCE_CENTS,
  readMoneyLayer,
  readRelationLayer,
  readSocialsLayer,
} from './brand'
import { resolveTenantSettings } from './layers'

import type { TenantLayerSource } from './layers'

/**
 * Чтение слоёв брендовых ассетов и денежных настроек (ТЗ 2.1, 3.3).
 *
 * Проверяется не «функция возвращает объект», а решения, которые она
 * принимает за редактора: что считать незаполненным, что — негодным, и чем
 * одно отличается от другого.
 */

describe('readRelationLayer', () => {
  it('режим без файла — это «не задано», а не «стереть логотип бренда»', () => {
    expect(readRelationLayer({ mode: 'override', value: null })).toEqual({ state: 'unset' })
    expect(readRelationLayer({ mode: 'fork', value: '' })).toEqual({ state: 'unset' })
  })

  it('«наследуется» не смотрит на значение вовсе', () => {
    expect(readRelationLayer({ mode: 'inherit', value: 42 })).toEqual({ state: 'unset' })
  })

  /**
   * Payload отдаёт связь то числом, то развёрнутым документом — в зависимости
   * от глубины выборки. Слой обязан читаться одинаково в обоих случаях, иначе
   * логотип «исчезает» при чтении с другой глубиной.
   */
  it('читает ссылку и идентификатором, и развёрнутым документом', () => {
    expect(readRelationLayer({ mode: 'override', value: 17 })).toEqual({
      state: 'override',
      value: '17',
    })
    expect(readRelationLayer({ mode: 'override', value: { id: 17, alt: 'Логотип' } })).toEqual({
      state: 'override',
      value: '17',
    })
  })
})

describe('readMoneyLayer', () => {
  it('принимает целое число центов', () => {
    expect(readMoneyLayer({ mode: 'override', value: 1_000_000 })).toEqual({
      state: 'override',
      value: 1_000_000,
    })
  })

  /**
   * Postgres отдаёт `numeric` строкой, и значение приезжает сюда как
   * `'1000000'`. Если бы слой принимал только `number`, настроенный баланс
   * выглядел бы незаданным — причём только на живой базе, где тесты на
   * функции этого не видят.
   */
  it('принимает строку из базы: numeric приезжает строкой', () => {
    expect(readMoneyLayer({ mode: 'override', value: '1000000' })).toEqual({
      state: 'override',
      value: 1_000_000,
    })
  })

  it('ноль — законное значение, а не «не задано»', () => {
    expect(readMoneyLayer({ mode: 'override', value: 0 })).toEqual({ state: 'override', value: 0 })
  })

  /**
   * Главное свойство: негодное значение становится «не задано», а не нулём.
   * Ноль — правдоподобный баланс, по нему не идут разбираться; `null` в
   * ответе вызывает вопрос. `'NaN'` здесь не выдуман: строка разбирается в
   * число успешно, а приведение к целому даёт ноль — этот путь уже стоил нам
   * цены ноль в тикерах.
   */
  it.each([
    ['NaN строкой', 'NaN'],
    ['пустая строка', '   '],
    ['дробное', 1000.5],
    ['отрицательное', -1],
    ['бесконечность', Number.POSITIVE_INFINITY],
    ['за верхней границей', MAX_DEMO_START_BALANCE_CENTS + 1],
    ['не число и не строка', { amount: 100 }],
  ])('негодное значение (%s) даёт «не задано», а не ноль', (_name, value) => {
    expect(readMoneyLayer({ mode: 'override', value })).toEqual({ state: 'unset' })
  })
})

describe('readSocialsLayer', () => {
  it('ключ — название сети: регион заменяет телеграм бренда, а не добавляет второй', () => {
    const layer = readSocialsLayer({
      mode: 'extend',
      items: [
        { name: 'Telegram', url: 'https://t.me/a' },
        { name: 'telegram', url: 'https://t.me/b' },
      ],
    })

    expect(layer.state).toBe('extend')
    expect(layer.state === 'extend' ? [...layer.items] : []).toEqual([
      ['telegram', 'https://t.me/b'],
    ])
  })

  it('пункт без названия или без ссылки отбрасывается', () => {
    const layer = readSocialsLayer({
      mode: 'extend',
      items: [{ name: 'youtube', url: '' }, { name: '', url: 'https://x' }, {}],
    })

    expect(layer.state === 'extend' ? layer.items.size : -1).toBe(0)
  })
})

describe('разрешение бренда по цепочке', () => {
  const chain = (
    brandData: Record<string, unknown>,
    siteData: Record<string, unknown>,
  ): TenantLayerSource[] => [
    {
      node: { id: 'brand', slug: 'apex', kind: 'brand', parentId: null },
      data: brandData,
    },
    {
      node: { id: 'site', slug: 'apex-de', kind: 'site', parentId: 'brand' },
      data: siteData,
    },
  ]

  /**
   * Свойство, ради которого ассеты наследуются по слотам, а не блоком:
   * сайт со своим фавиконом обязан сохранить логотип бренда. Блочное
   * наследование потребовало бы копировать логотип в каждую карточку — то
   * есть потерять связь с источником.
   */
  it('свой фавикон не отменяет унаследованного логотипа', () => {
    const settings = resolveTenantSettings(
      chain(
        { logoLight: { mode: 'override', value: 1 }, favicon: { mode: 'override', value: 2 } },
        { favicon: { mode: 'override', value: 3 } },
      ),
    )

    expect(settings.brand.assets.logoLight.value).toBe('1')
    expect(settings.brand.assets.logoLight.sourceTenantId).toBe('brand')
    expect(settings.brand.assets.favicon.value).toBe('3')
    expect(settings.brand.assets.favicon.sourceTenantId).toBe('site')
  })

  it('все слоты разрешаются, а не только названные в тесте', () => {
    const settings = resolveTenantSettings(chain({}, {}))

    expect(Object.keys(settings.brand.assets).sort()).toEqual([...BRAND_ASSET_SLOTS].sort())
  })

  it('демо-баланс наследуется от бренда и переопределяется сайтом', () => {
    expect(
      resolveTenantSettings(
        chain({ demoStartBalanceCents: { mode: 'override', value: 1_000_000 } }, {}),
      ).demoStartBalanceCents.value,
    ).toBe(1_000_000)

    expect(
      resolveTenantSettings(
        chain(
          { demoStartBalanceCents: { mode: 'override', value: 1_000_000 } },
          { demoStartBalanceCents: { mode: 'override', value: 5_000_000 } },
        ),
      ).demoStartBalanceCents.value,
    ).toBe(5_000_000)
  })

  /**
   * Негодное значение у сайта не «побеждает» нулём: слой становится
   * незаданным, и в силу вступает значение бренда. Иначе опечатка в карточке
   * одного сайта молча обнулила бы демо-счёт.
   */
  it('негодное значение у сайта отдаёт победу бренду, а не нулю', () => {
    expect(
      resolveTenantSettings(
        chain(
          { demoStartBalanceCents: { mode: 'override', value: 1_000_000 } },
          { demoStartBalanceCents: { mode: 'override', value: 'NaN' } },
        ),
      ).demoStartBalanceCents.value,
    ).toBe(1_000_000)
  })

  it('социальные сети накапливаются по цепочке и переопределяются по названию', () => {
    const settings = resolveTenantSettings(
      chain(
        {
          socials: {
            mode: 'extend',
            items: [
              { name: 'telegram', url: 'https://t.me/brand' },
              { name: 'youtube', url: 'https://youtube.com/brand' },
            ],
          },
        },
        { socials: { mode: 'extend', items: [{ name: 'telegram', url: 'https://t.me/de' }] } },
      ),
    )

    expect(settings.brand.socials.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['telegram', 'https://t.me/de'],
      ['youtube', 'https://youtube.com/brand'],
    ])
  })
})

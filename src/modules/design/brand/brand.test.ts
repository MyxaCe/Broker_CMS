import { describe, expect, it } from 'vitest'

import { composeBrand } from './compose'
import { mediaPublicUrl } from './load'
import { brandAssetsValidator } from './validator'

import type { ComposeBrandInput, MediaRecord } from './compose'
import type { BrandAssetSlot } from '@/platform'

/**
 * Брендовые ассеты в снапшоте (ТЗ 2.1, DEBT-014).
 *
 * Главное проверяемое свойство — **разница между «ассета нет» и «ассет есть,
 * но отдать его нечем»**. Первое законно, второе обязано останавливать
 * сборку: витрина получила бы битую картинку на месте логотипа и узнала бы
 * об этом от посетителя.
 */

const EMPTY_REFERENCES: Record<BrandAssetSlot, string | null> = {
  logoLight: null,
  logoDark: null,
  logoMono: null,
  logoMark: null,
  favicon: null,
  emailLogo: null,
}

const GOOD_FILE: MediaRecord = {
  id: '7',
  filename: 'logo.svg',
  width: 240,
  height: 64,
  mimeType: 'image/svg+xml',
  alt: 'Логотип Apex Capital',
}

function input(overrides: Partial<ComposeBrandInput> = {}): ComposeBrandInput {
  return {
    references: EMPTY_REFERENCES,
    media: new Map(),
    primaryColor: null,
    socials: [],
    publicUrl: (filename) => `https://media.example.com/bucket/${filename}`,
    ...overrides,
  }
}

describe('mediaPublicUrl', () => {
  it('собирает абсолютный адрес из базы, бакета и имени файла', () => {
    expect(
      mediaPublicUrl({
        base: 'http://localhost:9000',
        bucket: 'broker-cms-media',
        filename: 'logo.svg',
      }),
    ).toBe('http://localhost:9000/broker-cms-media/logo.svg')
  })

  it('лишние косые в базе и бакете не удваиваются', () => {
    expect(
      mediaPublicUrl({ base: 'https://cdn.example.com/', bucket: '/media/', filename: 'a.png' }),
    ).toBe('https://cdn.example.com/media/a.png')
  })

  it('имя файла экранируется: пробел в имени не ломает адрес', () => {
    expect(mediaPublicUrl({ base: 'https://c', bucket: 'b', filename: 'лого 2.png' })).toBe(
      'https://c/b/%D0%BB%D0%BE%D0%B3%D0%BE%202.png',
    )
  })
})

describe('composeBrand', () => {
  it('пустой слот — это пусто, и находок он не даёт', () => {
    const brand = composeBrand(input())

    expect(brand.assets.logoLight).toBeNull()
    expect(brand.findings).toEqual([])
    expect(brand.examinedReferences).toBe(0)
  })

  it('заполненный слот превращается в картинку контракта', () => {
    const brand = composeBrand(
      input({
        references: { ...EMPTY_REFERENCES, logoLight: '7' },
        media: new Map([['7', GOOD_FILE]]),
      }),
    )

    expect(brand.assets.logoLight).toEqual({
      url: 'https://media.example.com/bucket/logo.svg',
      width: 240,
      height: 64,
      alt: 'Логотип Apex Capital',
      mimeType: 'image/svg+xml',
    })
    expect(brand.examinedReferences).toBe(1)
  })

  /**
   * Ссылка в никуда не превращается в `null`: умолчание сказало бы
   * «логотипа нет», тогда как известно другое — «логотип выбран, показать
   * нечем». Чинятся эти два состояния разными действиями.
   */
  it('ссылка на несуществующий файл — находка, а не пустой слот', () => {
    const brand = composeBrand(input({ references: { ...EMPTY_REFERENCES, favicon: '404' } }))

    expect(brand.assets.favicon).toBeNull()
    expect(brand.findings.map((finding) => finding.code)).toEqual(['brand-asset-unresolved'])
    expect(brand.examinedReferences).toBe(1)
  })

  it.each([
    ['без имени файла', { filename: '' }],
    ['без ширины', { width: 0 }],
    ['с нечисловой высотой', { height: 'высокая' }],
    ['без типа содержимого', { mimeType: null }],
    ['без альтернативного текста', { alt: '  ' }],
  ])('негодная карточка файла (%s) блокирует, а не молчит', (_name, patch) => {
    const brand = composeBrand(
      input({
        references: { ...EMPTY_REFERENCES, logoLight: '7' },
        media: new Map([['7', { ...GOOD_FILE, ...patch }]]),
      }),
    )

    expect(brand.assets.logoLight).toBeNull()
    expect(brand.findings.map((finding) => finding.code)).toEqual(['brand-asset-unusable'])
  })

  /**
   * Порядок фиксирован сортировкой: отпечаток содержимого обязан зависеть от
   * данных, а не от того, в каком порядке цепочка наследования их накопила.
   * Тот же урок, что у списка локалей.
   */
  it('социальные сети отсортированы по названию сети', () => {
    const brand = composeBrand(
      input({
        socials: [
          { name: 'youtube', url: 'https://youtube.com/a' },
          { name: 'telegram', url: 'https://t.me/a' },
        ],
      }),
    )

    expect(brand.socials.map((social) => social.name)).toEqual(['telegram', 'youtube'])
  })
})

describe('brandAssetsValidator', () => {
  it('несобранный бренд отклоняет сборку, а не проходит молча', () => {
    expect(brandAssetsValidator.coverage({ brand: null })).toEqual({
      kind: 'missing',
      reason: 'сборка не передала брендовые ассеты',
    })
    expect(brandAssetsValidator.run({ brand: null }).map((finding) => finding.severity)).toEqual([
      'blocking',
    ])
  })

  /**
   * Охват считает **ссылки**, а не слоты: шесть пустых слотов и шесть
   * заполненных дали бы одинаковое число, и отчёт снова перестал бы
   * различать «проверено» и «проверять было нечего».
   */
  it('бренд без единой ссылки — «нечего было проверять», а не «нарушений нет»', () => {
    const brand = composeBrand(input())

    expect(brandAssetsValidator.coverage({ brand })).toEqual({
      kind: 'empty',
      reason: 'ни один слот брендовых ассетов не заполнен',
    })
  })

  it('отсутствие логотипа и фавикона — предупреждение: это регресс при переезде', () => {
    const findings = brandAssetsValidator.run({ brand: composeBrand(input()) })

    expect(findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
    expect(findings.map((finding) => finding.location)).toEqual([
      'logoLight',
      'favicon',
      'primaryColor',
    ])
  })

  it('битая ссылка блокирует сборку', () => {
    const brand = composeBrand(input({ references: { ...EMPTY_REFERENCES, logoLight: '404' } }))
    const findings = brandAssetsValidator.run({ brand })

    expect(findings.filter((finding) => finding.severity === 'blocking')).toHaveLength(1)
    expect(brandAssetsValidator.coverage({ brand })).toEqual({ kind: 'checked', examined: 1 })
  })
})

import { describe, expect, it } from 'vitest'

import { absolute, buildJsonLd } from './jsonld'

import type { JsonLdInput } from './jsonld'
import type { SeoProfileRecord } from './types'

const PROFILE: SeoProfileRecord = {
  ownerId: 'brand',
  locale: 'ru',
  isActive: true,
  titleTemplate: '%s — Apex',
  defaultDescription: null,
  defaultOgImage: null,
  twitterSite: '@apex',
  organization: {
    name: 'Apex Broker',
    legalName: 'Apex Markets Ltd',
    logo: 'https://cdn.apex.test/logo.svg',
    sameAs: ['https://x.com/apex'],
  },
  allowIndexing: true,
  disallowPaths: [],
}

function input(overrides: Partial<JsonLdInput> = {}): JsonLdInput {
  return {
    path: '/about',
    title: 'О компании',
    blocks: [],
    kind: 'auto',
    updatedAt: '2026-08-06T10:00:00.000Z',
    siteUrl: 'https://apex.test',
    profile: PROFILE,
    titlesByPath: new Map([
      ['/', 'Главная'],
      ['/about', 'О компании'],
    ]),
    ...overrides,
  }
}

function typesOf(nodes: readonly Record<string, unknown>[]): unknown[] {
  return nodes.map((node) => node['@type'])
}

describe('Organization', () => {
  /**
   * На каждой странице она означала бы, что каждая страница описывает
   * организацию, — а ошибку в реквизитах пришлось бы править в сотне мест.
   */
  it('отдаётся только на главной', () => {
    expect(typesOf(buildJsonLd(input({ path: '/' })))).toContain('Organization')
    expect(typesOf(buildJsonLd(input({ path: '/about' })))).not.toContain('Organization')
  })

  it('содержит реквизиты из профиля', () => {
    const node = buildJsonLd(input({ path: '/' })).find(
      (item) => item['@type'] === 'Organization',
    ) as Record<string, unknown>

    expect(node).toMatchObject({
      name: 'Apex Broker',
      legalName: 'Apex Markets Ltd',
      url: 'https://apex.test',
      logo: 'https://cdn.apex.test/logo.svg',
      sameAs: ['https://x.com/apex'],
    })
  })

  it('без профиля не выдумывается', () => {
    expect(typesOf(buildJsonLd(input({ path: '/', profile: null })))).not.toContain('Organization')
  })
})

describe('BreadcrumbList', () => {
  it('выводится из пути', () => {
    const node = buildJsonLd(input({ path: '/about' })).find(
      (item) => item['@type'] === 'BreadcrumbList',
    ) as Record<string, unknown>

    expect(node.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://apex.test/' },
      { '@type': 'ListItem', position: 2, name: 'О компании', item: 'https://apex.test/about' },
    ])
  })

  /**
   * Раздел без собственной страницы существует как ступень иерархии. Молчать
   * о нём значило бы показать поисковику разрыв.
   */
  it('промежуточный раздел без страницы попадает в цепочку без ссылки', () => {
    const node = buildJsonLd(
      input({
        path: '/accounts/pro',
        title: 'Pro',
        titlesByPath: new Map([['/', 'Главная']]),
      }),
    ).find((item) => item['@type'] === 'BreadcrumbList') as Record<string, unknown>

    expect(node.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://apex.test/' },
      { '@type': 'ListItem', position: 2, name: 'Accounts' },
      { '@type': 'ListItem', position: 3, name: 'Pro', item: 'https://apex.test/accounts/pro' },
    ])
  })

  it('на главной крошек нет', () => {
    expect(typesOf(buildJsonLd(input({ path: '/' })))).not.toContain('BreadcrumbList')
  })
})

describe('FAQPage', () => {
  const faqBlocks = [
    {
      type: 'faq',
      props: {
        items: [
          { question: 'Как открыть счёт?', answer: 'Заполните анкету.' },
          { question: 'Сколько ждать?', answer: 'До суток.' },
        ],
      },
    },
  ]

  /** Тип определяется содержимым: добавили аккордеон — появилась разметка. */
  it('собирается из блоков аккордеона, без отдельного поля', () => {
    const node = buildJsonLd(input({ blocks: faqBlocks })).find(
      (item) => item['@type'] === 'FAQPage',
    ) as Record<string, unknown>

    expect(node.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Как открыть счёт?',
        acceptedAnswer: { '@type': 'Answer', text: 'Заполните анкету.' },
      },
      {
        '@type': 'Question',
        name: 'Сколько ждать?',
        acceptedAnswer: { '@type': 'Answer', text: 'До суток.' },
      },
    ])
  })

  it('находит аккордеон и во вложенном слоте', () => {
    const nested = [{ type: 'columns', slots: { columns: faqBlocks } }]

    expect(typesOf(buildJsonLd(input({ blocks: nested })))).toContain('FAQPage')
  })

  it('вопрос без ответа не попадает в разметку', () => {
    const partial = [{ type: 'faq', props: { items: [{ question: 'Как?', answer: '  ' }] } }]

    expect(typesOf(buildJsonLd(input({ blocks: partial })))).not.toContain('FAQPage')
  })
})

describe('Article и отказ от разметки', () => {
  it('статья добавляется только по явному выбору', () => {
    expect(typesOf(buildJsonLd(input({ kind: 'article' })))).toContain('Article')
    expect(typesOf(buildJsonLd(input({ kind: 'auto' })))).not.toContain('Article')
  })

  it('«без разметки» отключает всё', () => {
    expect(buildJsonLd(input({ path: '/', kind: 'none' }))).toEqual([])
  })
})

describe('абсолютные адреса', () => {
  /** Относительная ссылка в JSON-LD не значит ничего. */
  it('без публичного адреса сайта ссылки не подставляются', () => {
    const node = buildJsonLd(input({ siteUrl: null, kind: 'article' })).find(
      (item) => item['@type'] === 'Article',
    ) as Record<string, unknown>

    expect(node.mainEntityOfPage).toBeUndefined()
  })

  it('завершающая косая черта в адресе сайта не удваивается', () => {
    expect(absolute('https://apex.test/', '/about')).toBe('https://apex.test/about')
  })
})

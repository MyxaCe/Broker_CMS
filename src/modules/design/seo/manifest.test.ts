import { describe, expect, it } from 'vitest'

import { composeRouting } from './manifest'

import type { ComposeRoutingArgs, ManifestPageInput } from './manifest'
import type { RedirectRecord, SeoProfileRecord } from './types'

const CHAIN = ['brand', 'region', 'site']

function page(overrides: Partial<ManifestPageInput> = {}): ManifestPageInput {
  return {
    id: '1',
    siteId: 'site',
    path: '/about',
    title: 'О компании',
    locale: 'ru',
    updatedAt: '2026-08-06T10:00:00.000Z',
    blocks: [],
    jsonLdKind: 'auto',
    translationKey: null,
    seo: { title: null, description: null, canonical: null, ogImage: null, noindex: false },
    ...overrides,
  }
}

function profile(overrides: Partial<SeoProfileRecord> = {}): SeoProfileRecord {
  return {
    ownerId: 'brand',
    locale: 'ru',
    isActive: true,
    titleTemplate: null,
    defaultDescription: 'Описание бренда',
    defaultOgImage: 'https://cdn.test/og.png',
    twitterSite: '@apex',
    organization: null,
    allowIndexing: true,
    disallowPaths: [],
    ...overrides,
  }
}

function redirect(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    from: '/old',
    to: '/new',
    status: 301,
    locale: 'ru',
    isActive: true,
    derived: false,
    ...overrides,
  }
}

function compose(overrides: Partial<ComposeRoutingArgs> = {}) {
  return composeRouting({
    chainIds: CHAIN,
    siteId: 'site',
    siteUrl: 'https://apex.ru',
    locales: ['ru'],
    pages: [page()],
    profiles: [profile()],
    redirects: [],
    siblingPages: [],
    siblingSites: [],
    ...overrides,
  })
}

describe('умолчания SEO', () => {
  it('описание и картинка берутся из профиля, когда у страницы своих нет', () => {
    const routing = compose()

    expect(routing.pages[0]).toMatchObject({
      description: 'Описание бренда',
      ogImage: 'https://cdn.test/og.png',
      twitterSite: '@apex',
    })
  })

  it('своё значение страницы перекрывает умолчание', () => {
    const routing = compose({
      pages: [
        page({
          seo: {
            title: null,
            description: 'Своё описание',
            canonical: null,
            ogImage: null,
            noindex: false,
          },
        }),
      ],
    })

    expect(routing.pages[0]?.description).toBe('Своё описание')
  })

  it('профиль сайта перекрывает профиль бренда', () => {
    const routing = compose({
      profiles: [profile(), profile({ ownerId: 'site', defaultDescription: 'Описание сайта' })],
    })

    expect(routing.pages[0]?.description).toBe('Описание сайта')
  })

  /** Иначе `%s | Apex` разворачивал бы каждый потребитель по-своему. */
  it('шаблон заголовка применяется у нас, а не у потребителя', () => {
    const routing = compose({ profiles: [profile({ titleTemplate: '%s — Apex' })] })

    expect(routing.pages[0]?.title).toBe('О компании — Apex')
  })

  /**
   * Заголовок вкладки и подпись в крошках — разные вещи. «О компании — Apex»
   * в хлебных крошках это заголовок документа, попавший не туда.
   */
  it('в разметку идёт заголовок без шаблона', () => {
    const routing = compose({ profiles: [profile({ titleTemplate: '%s — Apex' })] })
    const breadcrumbs = routing.pages[0]?.jsonLd.find(
      (node) => node['@type'] === 'BreadcrumbList',
    ) as Record<string, unknown>
    const items = breadcrumbs.itemListElement as Record<string, unknown>[]

    expect(items.at(-1)?.name).toBe('О компании')
  })
})

describe('канонический адрес', () => {
  it('по умолчанию собирается из публичного адреса сайта', () => {
    expect(compose().pages[0]?.canonical).toBe('https://apex.ru/about')
  })

  /**
   * Поисковик трактует относительный canonical от своего представления о
   * сайте, и страница склеивается не с той, с которой хотели.
   */
  it('относительный канонический адрес блокирует релиз', () => {
    const routing = compose({
      pages: [
        page({
          seo: {
            title: null,
            description: null,
            canonical: '/other',
            ogImage: null,
            noindex: false,
          },
        }),
      ],
    })

    expect(routing.findings).toContainEqual(
      expect.objectContaining({ code: 'canonical-not-absolute', severity: 'blocking' }),
    )
  })
})

describe('граф hreflang', () => {
  it('связывает языковые версии по ключу перевода', () => {
    const routing = compose({
      pages: [
        page({ id: '1', locale: 'ru', path: '/about', translationKey: 'about' }),
        page({ id: '2', locale: 'en', path: '/about-us', translationKey: 'about' }),
      ],
      locales: ['ru', 'en'],
      profiles: [profile(), profile({ locale: 'en' })],
    })

    expect(routing.pages[0]?.alternates).toEqual([
      { locale: 'en', href: 'https://apex.ru/about-us' },
      { locale: 'ru', href: 'https://apex.ru/about' },
    ])
  })

  /** «Между сайтами» из ТЗ — это именно соседние сайты бренда. */
  it('связывает страницы на соседнем сайте бренда', () => {
    const routing = compose({
      pages: [page({ id: '1', translationKey: 'about' })],
      siblingPages: [
        page({
          id: '9',
          siteId: 'de-site',
          locale: 'de',
          path: '/ueber-uns',
          translationKey: 'about',
        }),
      ],
      siblingSites: [{ id: 'de-site', locale: 'de', publicUrl: 'https://apex.de' }],
    })

    expect(routing.pages[0]?.alternates).toContainEqual({
      locale: 'de',
      href: 'https://apex.de/ueber-uns',
    })
  })

  it('сайт без публичного адреса выпадает из графа с предупреждением', () => {
    const routing = compose({
      pages: [page({ id: '1', translationKey: 'about' })],
      siblingPages: [
        page({
          id: '9',
          siteId: 'de-site',
          locale: 'de',
          path: '/ueber-uns',
          translationKey: 'about',
        }),
      ],
      siblingSites: [{ id: 'de-site', locale: 'de', publicUrl: null }],
    })

    expect(routing.pages[0]?.alternates.map((item) => item.locale)).toEqual(['ru'])
    expect(routing.findings).toContainEqual(
      expect.objectContaining({ code: 'hreflang-no-public-url', severity: 'warning' }),
    )
  })

  /** Выбор без правила: какая версия попадёт в hreflang, зависело бы от порядка чтения. */
  it('две страницы одного языка с одним ключом блокируют релиз', () => {
    const routing = compose({
      pages: [
        page({ id: '1', path: '/about', translationKey: 'about' }),
        page({ id: '2', path: '/about-us', translationKey: 'about' }),
      ],
    })

    expect(routing.findings).toContainEqual(
      expect.objectContaining({ code: 'hreflang-ambiguous', severity: 'blocking' }),
    )
  })

  it('страница без ключа перевода остаётся без альтернатив', () => {
    expect(compose().pages[0]?.alternates).toEqual([])
  })
})

describe('редиректы', () => {
  it('отдаются отсортированными и нормализованными', () => {
    const routing = compose({
      redirects: [redirect({ from: '/z-old' }), redirect({ from: '/A-Old/', to: '/new' })],
    })

    expect(routing.redirects.map((rule) => rule.from)).toEqual(['/a-old', '/z-old'])
  })

  it('у 410 цель пустая', () => {
    const routing = compose({ redirects: [redirect({ status: 410, to: '/что-то' })] })

    expect(routing.redirects[0]).toMatchObject({ status: 410, to: '' })
  })

  /** Браузер в цикле не открывает страницу вовсе. */
  it('цикл блокирует релиз', () => {
    const routing = compose({
      redirects: [redirect({ from: '/a', to: '/b' }), redirect({ from: '/b', to: '/a' })],
    })

    expect(routing.findings).toContainEqual(
      expect.objectContaining({ code: 'redirect-cycle', severity: 'blocking' }),
    )
  })

  it('два правила с одного адреса: побеждает первое, остальное — находка', () => {
    const routing = compose({
      redirects: [redirect({ to: '/first' }), redirect({ to: '/second' })],
    })

    expect(routing.redirects).toHaveLength(1)
    expect(routing.redirects[0]?.to).toBe('/first')
    expect(routing.findings).toContainEqual(expect.objectContaining({ code: 'redirect-duplicate' }))
  })

  /**
   * Правило из истории путей появляется автоматически и не должно
   * перекрывать осознанное решение редактора.
   */
  it('выведенное правило уступает заведённому руками и не блокирует', () => {
    const routing = compose({
      redirects: [redirect({ to: '/руками' }), redirect({ to: '/из-истории', derived: true })],
    })

    expect(routing.redirects[0]?.to).toBe('/руками')
    expect(
      routing.findings.filter((finding) => finding.code === 'redirect-duplicate')[0]?.severity,
    ).toBe('warning')
  })

  it('отключённое правило в выдачу не попадает', () => {
    expect(compose({ redirects: [redirect({ isActive: false })] }).redirects).toEqual([])
  })
})

describe('директивы robots', () => {
  /** Открытый по ошибке сайт убирается из индекса месяцами. */
  it('без профиля индексация запрещена', () => {
    expect(compose({ profiles: [] }).robots).toEqual({ allowIndexing: false, disallow: [] })
  })

  it('индексация разрешена, только если её разрешает каждый язык', () => {
    const args = {
      locales: ['ru', 'en'],
      pages: [page(), page({ id: '2', locale: 'en' })],
    }

    expect(
      compose({ ...args, profiles: [profile(), profile({ locale: 'en' })] }).robots.allowIndexing,
    ).toBe(true)

    expect(
      compose({
        ...args,
        profiles: [profile(), profile({ locale: 'en', allowIndexing: false })],
      }).robots.allowIndexing,
    ).toBe(false)
  })

  it('закрытые разделы собираются со всех языков без повторов', () => {
    const routing = compose({
      locales: ['ru', 'en'],
      profiles: [
        profile({ disallowPaths: ['/preview', '/internal'] }),
        profile({ locale: 'en', disallowPaths: ['/preview'] }),
      ],
    })

    expect(routing.robots.disallow).toEqual(['/internal', '/preview'])
  })
})

describe('детерминированность', () => {
  it('порядок страниц не зависит от порядка на входе', () => {
    const pages = [
      page({ id: '3', path: '/z', locale: 'ru' }),
      page({ id: '1', path: '/a', locale: 'ru' }),
      page({ id: '2', path: '/m', locale: 'en' }),
    ]

    const forward = compose({ pages, locales: ['ru', 'en'] })
    const backward = compose({ pages: [...pages].reverse(), locales: ['ru', 'en'] })

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
  })
})

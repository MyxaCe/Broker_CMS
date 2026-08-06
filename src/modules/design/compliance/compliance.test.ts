import { describe, expect, it } from 'vitest'

import { isKnownJurisdiction, requirementsFor } from './jurisdictions'
import {
  checkImageAlt,
  checkJurisdictionVisibility,
  checkRiskWarning,
  collectBlocks,
  collectMediaReferences,
  requiredDisclaimers,
  runComplianceRules,
} from './rules'

import type { ComplianceInput } from './rules'

function input(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    jurisdiction: 'eu-mifid',
    locales: ['en'],
    riskWarnings: [
      {
        isActive: true,
        text: 'Торговля CFD сопряжена с риском.',
        lossPercentage: 74,
        locale: 'en',
      },
    ],
    pages: [],
    mediaAlt: new Map(),
    ...overrides,
  }
}

describe('требования юрисдикций', () => {
  it('известная юрисдикция возвращает свои требования', () => {
    expect(requirementsFor('eu-mifid').riskWarningRequired).toBe(true)
    expect(isKnownJurisdiction('eu-mifid')).toBe(true)
  })

  /**
   * Ключевое решение: опечатка в коде юрисдикции не должна молча снимать
   * комплаенс-проверку.
   */
  it.each([null, undefined, '', 'выдуманная'])(
    'неизвестная юрисдикция (%s) получает строгие требования',
    (code) => {
      const requirements = requirementsFor(code)

      expect(requirements.riskWarningRequired).toBe(true)
      expect(requirements.lossPercentageRequired).toBe(true)
    },
  )

  it('неизвестная юрисдикция помечена в названии', () => {
    expect(requirementsFor('xx-выдумка').title).toContain('неизвестная')
  })
})

describe('риск-предупреждение', () => {
  it('действующая полоса с текстом нарушений не даёт', () => {
    expect(checkRiskWarning(input())).toEqual([])
  })

  it('отсутствие полосы блокирует', () => {
    const findings = checkRiskWarning(input({ riskWarnings: [] }))

    expect(findings[0]?.code).toBe('risk-warning-missing')
  })

  it('отключённая полоса считается отсутствующей', () => {
    const findings = checkRiskWarning(
      input({
        riskWarnings: [{ isActive: false, text: 'Текст', lossPercentage: 74, locale: 'en' }],
      }),
    )

    expect(findings[0]?.code).toBe('risk-warning-missing')
  })

  /** Пустая полоса — не предупреждение, а место, где оно должно было быть. */
  it.each([null, '', '   '])('полоса с пустым текстом (%s) блокирует', (text) => {
    const findings = checkRiskWarning(
      input({ riskWarnings: [{ isActive: true, text, lossPercentage: 74, locale: 'en' }] }),
    )

    expect(findings[0]?.code).toBe('risk-warning-empty')
  })

  /**
   * Предупреждение, существующее только по-английски, не выполняет своей
   * задачи на немецкой версии — его там просто не прочитают.
   */
  it('проверяется каждая локаль сайта', () => {
    const findings = checkRiskWarning(input({ locales: ['en', 'de'] }))

    expect(findings).toHaveLength(1)
    expect(findings[0]?.location).toContain('de')
  })

  it('доля теряющих счетов обязательна там, где требуется', () => {
    const findings = checkRiskWarning(
      input({
        riskWarnings: [{ isActive: true, text: 'Текст', lossPercentage: null, locale: 'en' }],
      }),
    )

    expect(findings[0]?.code).toBe('loss-percentage-missing')
  })

  it('где не требуется — не блокирует', () => {
    const findings = checkRiskWarning(
      input({
        jurisdiction: 'au-asic',
        riskWarnings: [{ isActive: true, text: 'Текст', lossPercentage: null, locale: 'en' }],
      }),
    )

    expect(findings).toEqual([])
  })
})

describe('обязательный alt', () => {
  const page = {
    path: '/about',
    locale: 'en',
    jurisdictions: [],
    blocks: [{ type: 'hero', props: { image: 7 } }],
  }

  it('изображение с alt нарушений не даёт', () => {
    const findings = checkImageAlt(input({ pages: [page], mediaAlt: new Map([['7', true]]) }))

    expect(findings).toEqual([])
  })

  /** «Нет alt — релиз не собирается» (ТЗ 2.4). */
  it('изображение без alt блокирует', () => {
    const findings = checkImageAlt(input({ pages: [page], mediaAlt: new Map([['7', false]]) }))

    expect(findings[0]?.code).toBe('image-without-alt')
    expect(findings[0]?.location).toContain('/about')
  })

  it('вложенное изображение тоже проверяется', () => {
    const nested = {
      ...page,
      blocks: [{ type: 'columns', slots: { columns: [{ type: 'image', props: { image: 9 } }] } }],
    }

    const findings = checkImageAlt(input({ pages: [nested], mediaAlt: new Map([['9', false]]) }))

    expect(findings).toHaveLength(1)
  })

  it('развёрнутая связь распознаётся так же, как идентификатор', () => {
    const expanded = { ...page, blocks: [{ type: 'hero', props: { cover: { id: 12 } } }] }

    const findings = checkImageAlt(input({ pages: [expanded], mediaAlt: new Map([['12', false]]) }))

    expect(findings).toHaveLength(1)
  })

  it('галерея из нескольких файлов проверяется целиком', () => {
    const gallery = { ...page, blocks: [{ type: 'image', props: { images: [1, 2] } }] }

    const findings = checkImageAlt(
      input({
        pages: [gallery],
        mediaAlt: new Map([
          ['1', true],
          ['2', false],
        ]),
      }),
    )

    expect(findings).toHaveLength(1)
  })
})

describe('юрисдикционная видимость', () => {
  it('страница без ограничений нарушений не даёт', () => {
    const findings = checkJurisdictionVisibility(
      input({ pages: [{ path: '/', locale: 'en', jurisdictions: [], blocks: [] }] }),
    )

    expect(findings).toEqual([])
  })

  /** Содержимое, которое не покажется никогда, — почти всегда опечатка. */
  it('страница, ограниченная чужими юрисдикциями, — нарушение', () => {
    const findings = checkJurisdictionVisibility(
      input({ pages: [{ path: '/uk', locale: 'en', jurisdictions: ['uk-fca'], blocks: [] }] }),
    )

    expect(findings[0]?.code).toBe('unreachable-jurisdiction')
  })

  it('страница, включающая юрисдикцию сайта, проходит', () => {
    const findings = checkJurisdictionVisibility(
      input({
        pages: [{ path: '/eu', locale: 'en', jurisdictions: ['eu-mifid', 'uk-fca'], blocks: [] }],
      }),
    )

    expect(findings).toEqual([])
  })

  it('блок с недостижимым ограничением — нарушение', () => {
    const findings = checkJurisdictionVisibility(
      input({
        pages: [
          {
            path: '/',
            locale: 'en',
            jurisdictions: [],
            blocks: [{ type: 'hero', visibility: { jurisdictions: [{ code: 'ru-cbr' }] } }],
          },
        ],
      }),
    )

    expect(findings[0]?.code).toBe('unreachable-jurisdiction')
    expect(findings[0]?.location).toContain('blocks[0]')
  })
})

describe('обход дерева', () => {
  it('находит вложенные блоки', () => {
    const blocks = [{ type: 'columns', slots: { columns: [{ type: 'quote' }] } }]
    const found = collectBlocks(blocks)

    expect(found.map((node) => node.type)).toEqual(['columns', 'quote'])
  })

  it('испорченный вход не роняет обход', () => {
    expect(() => collectBlocks('не список')).not.toThrow()
    expect(collectBlocks(null)).toEqual([])
  })

  it('ссылки на медиа находятся в любых полях из перечня', () => {
    const found = collectMediaReferences([
      { type: 'hero', props: { cover: 1, nested: { poster: 2 } } },
    ])

    expect(found.map((item) => item.id).sort()).toEqual(['1', '2'])
  })
})

describe('дисклеймеры по типу блока', () => {
  /**
   * Ручное прикрепление означает, что рано или поздно забудут — и забудут
   * именно там, где нужнее всего.
   */
  it('калькулятор требует своего дисклеймера', () => {
    expect(requiredDisclaimers([{ type: 'calculator' }])).toEqual(['disclaimer.calculator'])
  })

  it('таблицы условий требуют дисклеймера торговых условий', () => {
    expect(requiredDisclaimers([{ type: 'pricing-grid' }, { type: 'account-types' }])).toEqual([
      'disclaimer.trading-conditions',
    ])
  })

  it('блок без правила дисклеймера не требует', () => {
    expect(requiredDisclaimers([{ type: 'quote' }])).toEqual([])
  })

  it('вложенный блок тоже учитывается', () => {
    const blocks = [{ type: 'columns', slots: { columns: [{ type: 'calculator' }] } }]

    expect(requiredDisclaimers(blocks)).toEqual(['disclaimer.calculator'])
  })

  it('перечень без повторов и в устойчивом порядке', () => {
    const blocks = [{ type: 'quote-ticker' }, { type: 'calculator' }, { type: 'economic-calendar' }]

    expect(requiredDisclaimers(blocks)).toEqual(['disclaimer.calculator', 'disclaimer.market-data'])
  })
})

describe('полный прогон', () => {
  it('здоровое состояние нарушений не даёт', () => {
    expect(runComplianceRules(input())).toEqual([])
  })

  it('собирает нарушения всех видов сразу', () => {
    const findings = runComplianceRules(
      input({
        riskWarnings: [],
        pages: [
          {
            path: '/broken',
            locale: 'en',
            jurisdictions: ['uk-fca'],
            blocks: [{ type: 'hero', props: { image: 5 } }],
          },
        ],
        mediaAlt: new Map([['5', false]]),
      }),
    )

    const codes = findings.map((finding) => finding.code)

    expect(codes).toContain('risk-warning-missing')
    expect(codes).toContain('image-without-alt')
    expect(codes).toContain('unreachable-jurisdiction')
  })
})

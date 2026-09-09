import { describe, expect, it } from 'vitest'

import { collectTexts } from './collect-text'

/**
 * Проверка существует ради дефекта, который она предотвращает: стоп-словарь
 * получал пустой список текстов и отвечал «нарушений нет» (DEBT-013). Поэтому
 * здесь важнее всего не форма результата, а то, что текст **находится**.
 */

const ARGS = { location: 'страница /about (de)', contentClass: 'marketing' as const }

describe('collectTexts — что считается текстом', () => {
  it('берёт заголовок и подзаголовок героя', () => {
    const texts = collectTexts(
      [{ type: 'hero', props: { title: 'Гарантированный доход', subtitle: 'Каждый месяц' } }],
      ARGS,
    )

    expect(texts.map((item) => item.text)).toEqual(['Гарантированный доход', 'Каждый месяц'])
  })

  it('не считает текстом адрес ссылки и идентификатор файла', () => {
    const texts = collectTexts(
      [{ type: 'hero', props: { ctaHref: 'https://example.com/доход', image: 'media-42' } }],
      ARGS,
    )

    expect(texts).toEqual([])
  })

  it('пустая строка и пробелы текстом не считаются', () => {
    const texts = collectTexts([{ type: 'hero', props: { title: '   ', subtitle: '' } }], ARGS)

    expect(texts).toEqual([])
  })

  it('адрес находки ведёт к конкретному пропсу конкретного блока', () => {
    const [item] = collectTexts([{ type: 'hero', props: { title: 'Заголовок' } }], ARGS)

    expect(item?.location).toBe('страница /about (de) · blocks[0].title')
    expect(item?.contentClass).toBe('marketing')
  })
})

describe('collectTexts — вложенность', () => {
  /** Правило, действующее только на верхнем уровне, обходится переносом блока. */
  it('находит текст во вложенном слоте', () => {
    const texts = collectTexts(
      [
        {
          type: 'columns',
          props: {},
          slots: { content: [{ type: 'quote', props: { text: 'Доходность 300%' } }] },
        },
      ],
      ARGS,
    )

    expect(texts.map((item) => item.text)).toContain('Доходность 300%')
  })

  it('находит текст в повторяемой группе', () => {
    const texts = collectTexts(
      [
        {
          type: 'faq',
          props: {
            items: [
              { question: 'Есть ли риск?', answer: 'Прибыль гарантирована' },
              { question: 'А комиссия?', answer: 'Ноль' },
            ],
          },
        },
      ],
      ARGS,
    )

    expect(texts.map((item) => item.text)).toContain('Прибыль гарантирована')
  })
})

describe('collectTexts — повреждённый вход', () => {
  /**
   * Дерево приходит полем JSON. Исключение здесь означало бы, что одна
   * опечатка снова превращает гейт в молчание — то есть ровно тот дефект,
   * ради которого сбор и написан.
   */
  it.each([
    ['не массив', { type: 'hero' }],
    ['null', null],
    ['строка', 'hero'],
    ['массив мусора', [null, 42, 'x']],
  ])('%s не роняет сбор', (_name, blocks) => {
    expect(() => collectTexts(blocks, ARGS)).not.toThrow()
    expect(collectTexts(blocks, ARGS)).toEqual([])
  })

  it('неизвестный тип блока пропускается без исключения', () => {
    expect(collectTexts([{ type: 'нет-такого', props: { title: 'Текст' } }], ARGS)).toEqual([])
  })

  it('блок без пропсов пропускается', () => {
    expect(collectTexts([{ type: 'hero' }], ARGS)).toEqual([])
  })
})

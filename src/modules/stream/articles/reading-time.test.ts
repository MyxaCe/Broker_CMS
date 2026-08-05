import { describe, expect, it } from 'vitest'

import { countWords, estimateReadingMinutes, extractText } from './reading-time'

describe('извлечение текста', () => {
  it('берёт текст из вложенной структуры редактора', () => {
    const body = {
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Ставка' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'повышена' }] },
        ],
      },
    }

    expect(extractText(body).split(/\s+/).filter(Boolean)).toEqual(['Ставка', 'повышена'])
  })

  /**
   * Разбор, знающий схему редактора наизусть, ломался бы при каждом добавлении
   * блока. Здесь структура намеренно незнакомая.
   */
  it('справляется с неизвестной формой блока', () => {
    const body = { что: { угодно: [{ глубоко: { text: 'найдено' } }] } }

    expect(extractText(body)).toContain('найдено')
  })

  it('не считает служебные поля за слова', () => {
    const body = { type: 'paragraph', format: 'left', version: 1, children: [] }

    expect(countWords(extractText(body))).toBe(0)
  })

  it('пустое и отсутствующее тело дают пустой текст', () => {
    expect(extractText(null)).toBe('')
    expect(extractText(undefined)).toBe('')
    expect(countWords(extractText({}))).toBe(0)
  })
})

describe('оценка времени чтения', () => {
  /**
   * «1 минута чтения» у пустого черновика выглядит как настоящее значение и
   * мешает заметить, что текста нет.
   */
  it('пустой текст даёт ноль, а не минуту', () => {
    expect(estimateReadingMinutes(null)).toBe(0)
    expect(estimateReadingMinutes({ root: { children: [] } })).toBe(0)
  })

  it('любой непустой текст — минимум минута', () => {
    expect(estimateReadingMinutes({ text: 'Коротко' })).toBe(1)
  })

  it('длинный текст оценивается пропорционально', () => {
    const words = Array.from({ length: 900 }, () => 'слово').join(' ')

    expect(estimateReadingMinutes({ text: words })).toBe(5)
  })

  it('одинаковый текст даёт одинаковую оценку', () => {
    const body = { text: 'Ставка повышена на четверть процентного пункта' }

    expect(estimateReadingMinutes(body)).toBe(estimateReadingMinutes(body))
  })
})

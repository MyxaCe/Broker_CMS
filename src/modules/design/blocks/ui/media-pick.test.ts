import { describe, expect, it } from 'vitest'

import {
  describeRow,
  describeSelection,
  mediaByIdUrl,
  mediaDocsOf,
  mediaSearchUrl,
  MEDIA_SEARCH_LIMIT,
  toMediaRow,
} from './media-pick'

const GOOD = {
  id: 7,
  alt: 'Логотип Apex Capital',
  filename: 'apex-logo.png',
  mimeType: 'image/png',
  width: 512,
  height: 128,
  url: 'https://media.example.test/apex-logo.png',
}

describe('карточка файла читается из ответа API', () => {
  it('годная карточка превращается в строку целиком', () => {
    expect(toMediaRow(GOOD)).toEqual({
      id: '7',
      alt: 'Логотип Apex Capital',
      filename: 'apex-logo.png',
      mimeType: 'image/png',
      width: 512,
      height: 128,
      url: 'https://media.example.test/apex-logo.png',
    })
  })

  it('пустой адрес читается как отсутствие адреса, а не как пустая строка', () => {
    expect(toMediaRow({ ...GOOD, url: '' }).url).toBeNull()
  })

  it('список берётся из docs, а записи без идентификатора отбрасываются', () => {
    const rows = mediaDocsOf({ docs: [GOOD, { alt: 'без id' }, null, 'строка'] })

    expect(rows.map((row) => row.id)).toEqual(['7'])
  })

  it('ответ без docs даёт пустой список, а не падение', () => {
    expect(mediaDocsOf(null)).toEqual([])
    expect(mediaDocsOf({ error: 'unauthorized' })).toEqual([])
  })
})

describe('адреса запросов к медиатеке', () => {
  it('пустой запрос не добавляет фильтра — показывается последнее загруженное', () => {
    const url = mediaSearchUrl('   ')

    expect(url).toContain(`limit=${MEDIA_SEARCH_LIMIT}`)
    expect(url).not.toContain('where')
  })

  it('поиск идёт по описанию, а не по имени файла', () => {
    expect(mediaSearchUrl('логотип')).toContain('where[alt][like]=')
  })

  it('запрос кодируется: описание с пробелом и амперсандом не ломает адрес', () => {
    const url = mediaSearchUrl('логотип & фавикон')

    expect(url).not.toContain(' ')
    expect(url.split('where[alt][like]=')[1]).not.toContain('&')
  })

  it('идентификатор в адресе карточки тоже кодируется', () => {
    expect(mediaByIdUrl('a/b')).toBe('/api/media/a%2Fb?depth=0')
  })
})

describe('состояние поля различает четыре разных причины «картинки нет»', () => {
  it('пустое значение — файл не выбран', () => {
    expect(describeSelection({ value: '', card: undefined }).kind).toBe('empty')
    expect(describeSelection({ value: '   ', card: undefined }).kind).toBe('empty')
    expect(describeSelection({ value: null, card: undefined }).kind).toBe('empty')
  })

  it('карточку ещё не читали — это загрузка, а не отсутствие', () => {
    expect(describeSelection({ value: '7', card: undefined }).kind).toBe('loading')
  })

  it('карточки нет — ссылка в никуда, и об этом сказано словами', () => {
    const selection = describeSelection({ value: '7', card: null })

    expect(selection.kind).toBe('unresolved')
    expect(selection.kind === 'unresolved' ? selection.note : '').toContain(
      'которого в медиатеке нет',
    )
  })

  it('медиатека не ответила — это отказ, и он не выдаётся за удаление файла', () => {
    const selection = describeSelection({ value: '7', card: undefined, failure: 'HTTP 500' })

    expect(selection.kind).toBe('unreadable')
    expect(selection.kind === 'unreadable' ? selection.note : '').toContain('отказ медиатеки')
  })

  it('отказ сильнее отсутствия: прочитанное «нет» не перекрывает непрочитанное', () => {
    /**
     * Порядок проверок значим. Если бы `card: null` рассматривался раньше
     * отказа, сорванный запрос, оставивший прошлое `null`, читался бы как
     * «файл удалён» — и редактор стёр бы живую ссылку.
     */
    expect(describeSelection({ value: '7', card: null, failure: 'HTTP 503' }).kind).toBe(
      'unreadable',
    )
  })

  it('годная карточка — выбрано', () => {
    expect(describeSelection({ value: '7', card: toMediaRow(GOOD) }).kind).toBe('resolved')
  })
})

describe('негодная карточка отличается от отсутствующей', () => {
  it('карточка без альтернативного текста не годится — тем же критерием, что у сборки', () => {
    const selection = describeSelection({ value: '7', card: toMediaRow({ ...GOOD, alt: '' }) })

    expect(selection.kind).toBe('unusable')
    expect(selection.kind === 'unusable' ? selection.note : '').toContain('альтернативный текст')
  })

  it('карточка без размеров не годится, и перечислено оба поля', () => {
    const selection = describeSelection({
      value: '7',
      card: toMediaRow({ ...GOOD, width: null, height: null }),
    })

    expect(selection.kind === 'unusable' ? selection.note : '').toContain('ширина, высота')
  })

  it('сообщение предупреждает, что сборка релиза остановится на том же месте', () => {
    const selection = describeSelection({ value: '7', card: toMediaRow({ ...GOOD, alt: '' }) })

    expect(selection.kind === 'unusable' ? selection.note : '').toContain('Сборка релиза')
  })
})

describe('подпись карточки', () => {
  it('описание, размер и тип — всё, что нужно, чтобы узнать файл', () => {
    expect(describeRow(toMediaRow(GOOD))).toBe('Логотип Apex Capital · 512×128 · image/png')
  })

  it('без описания подставляется имя файла, а не пустое место', () => {
    expect(describeRow(toMediaRow({ ...GOOD, alt: '' }))).toContain('apex-logo.png')
  })

  it('без описания и без имени остаётся идентификатор: строка не бывает пустой', () => {
    expect(describeRow(toMediaRow({ id: 9, alt: '', filename: null }))).toBe('#9')
  })
})

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_MIME_TYPES,
  checkUpload,
  describeRejection,
  extensionOf,
  MAX_UPLOAD_BYTES,
  SVG_MIME_TYPE,
} from './upload-rules'

import type { UploadCandidate } from './upload-rules'

function candidate(overrides: Partial<UploadCandidate> = {}): UploadCandidate {
  return {
    mimeType: 'image/png',
    bytes: 1024,
    filename: 'график.png',
    mayUploadSvg: false,
    ...overrides,
  }
}

describe('разрешённые типы', () => {
  it.each(ALLOWED_MIME_TYPES)('%s принимается', (mimeType) => {
    const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1]

    expect(checkUpload(candidate({ mimeType, filename: `файл.${extension}` }))).toBeNull()
  })

  it.each([
    'text/html',
    'application/javascript',
    'application/x-msdownload',
    'application/zip',
    'text/plain',
  ])('%s отвергается', (mimeType) => {
    expect(checkUpload(candidate({ mimeType }))?.kind).toBe('mime-not-allowed')
  })

  /** Перечень закрытый: запретительный список всегда отстаёт от выдумки. */
  it('неизвестный тип отвергается, а не пропускается', () => {
    expect(checkUpload(candidate({ mimeType: 'application/выдумка' }))?.kind).toBe(
      'mime-not-allowed',
    )
  })

  it('параметры в заголовке типа не мешают распознаванию', () => {
    expect(checkUpload(candidate({ mimeType: 'image/png; charset=binary' }))).toBeNull()
  })

  it('регистр типа не имеет значения', () => {
    expect(checkUpload(candidate({ mimeType: 'IMAGE/PNG' }))).toBeNull()
  })
})

describe('SVG', () => {
  /** Право загрузить SVG — по сути право выполнить код в интерфейсе. */
  it('обычному редактору запрещён', () => {
    expect(checkUpload(candidate({ mimeType: SVG_MIME_TYPE, filename: 'логотип.svg' }))?.kind).toBe(
      'svg-forbidden',
    )
  })

  it('кросс-тенантной роли разрешён', () => {
    expect(
      checkUpload(
        candidate({ mimeType: SVG_MIME_TYPE, filename: 'логотип.svg', mayUploadSvg: true }),
      ),
    ).toBeNull()
  })

  it('в общий перечень разрешённых не входит', () => {
    expect(ALLOWED_MIME_TYPES as readonly string[]).not.toContain(SVG_MIME_TYPE)
  })
})

describe('соответствие расширения типу', () => {
  /**
   * Имя с расширением `.html` при типе `image/png` — способ заставить браузер
   * посмотреть на содержимое, а не на заголовок.
   */
  it('расширение, не совпадающее с типом, отвергается', () => {
    expect(checkUpload(candidate({ filename: 'страница.html' }))?.kind).toBe('extension-mismatch')
  })

  it('двойное расширение проверяется по последнему', () => {
    expect(checkUpload(candidate({ filename: 'картинка.png.html' }))?.kind).toBe(
      'extension-mismatch',
    )
  })

  it('файл без расширения отвергается', () => {
    expect(checkUpload(candidate({ filename: 'безимени' }))?.kind).toBe('extension-mismatch')
  })

  it('jpg и jpeg одинаково допустимы', () => {
    expect(checkUpload(candidate({ mimeType: 'image/jpeg', filename: 'фото.jpg' }))).toBeNull()
    expect(checkUpload(candidate({ mimeType: 'image/jpeg', filename: 'фото.jpeg' }))).toBeNull()
  })

  it('регистр расширения не имеет значения', () => {
    expect(checkUpload(candidate({ filename: 'ГРАФИК.PNG' }))).toBeNull()
  })

  it('извлечение расширения', () => {
    expect(extensionOf('файл.tar.gz')).toBe('gz')
    expect(extensionOf('файл')).toBe('')
    expect(extensionOf('.gitignore')).toBe('gitignore')
  })
})

describe('размер', () => {
  it('файл в пределах допустим', () => {
    expect(checkUpload(candidate({ bytes: MAX_UPLOAD_BYTES }))).toBeNull()
  })

  it('файл сверх предела отвергается', () => {
    expect(checkUpload(candidate({ bytes: MAX_UPLOAD_BYTES + 1 }))?.kind).toBe('too-large')
  })

  /**
   * Тип проверяется раньше размера намеренно: «файл не того типа» — более
   * точная причина, и именно её стоит показать редактору.
   */
  it('у большого файла запрещённого типа причина — тип', () => {
    expect(
      checkUpload(candidate({ mimeType: 'text/html', bytes: MAX_UPLOAD_BYTES * 2 }))?.kind,
    ).toBe('mime-not-allowed')
  })
})

describe('сообщения об отказе', () => {
  it.each([
    { kind: 'mime-not-allowed', mimeType: 'text/html' },
    { kind: 'svg-forbidden' },
    { kind: 'too-large', bytes: 99_000_000, limit: MAX_UPLOAD_BYTES },
    { kind: 'extension-mismatch', extension: 'html', mimeType: 'image/png' },
  ] as const)('$kind объясняется словами', (rejection) => {
    const message = describeRejection(rejection)

    expect(message.length).toBeGreaterThan(20)
    expect(message).not.toContain('undefined')
  })
})

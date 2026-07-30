import { describe, expect, it } from 'vitest'

import { FIRST_RELEASE_NUMBER, nextReleaseNumber, ReleaseNumberingError } from './numbering'

describe('nextReleaseNumber', () => {
  it('первый релиз сайта получает номер 1', () => {
    expect(nextReleaseNumber([])).toBe(FIRST_RELEASE_NUMBER)
  })

  it('следующий номер — на единицу больше наибольшего', () => {
    expect(nextReleaseNumber([1, 2, 3])).toBe(4)
  })

  it('порядок в списке не важен', () => {
    expect(nextReleaseNumber([3, 1, 2])).toBe(4)
  })

  it('пропуски не заполняются — выданный номер не выдаётся повторно', () => {
    expect(nextReleaseNumber([1, 2, 7])).toBe(8)
  })

  it('номер проваленного релиза тоже занят навсегда', () => {
    // 5 остался за неудачной сборкой; 5 больше никому не достанется.
    expect(nextReleaseNumber([4, 5])).toBe(6)
  })

  it.each([0, -1, 1.5, Number.NaN])('отвергает недопустимый номер %s', (value) => {
    expect(() => nextReleaseNumber([1, value])).toThrow(ReleaseNumberingError)
  })
})

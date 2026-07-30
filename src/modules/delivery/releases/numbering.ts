/**
 * Нумерация релизов (ТЗ часть 3).
 *
 * Номер — то, чем оперирует человек: «откатились на 41», «на проде 42».
 * Поэтому он монотонный, целый и **свой у каждого сайта**: сквозная нумерация
 * по всем сайтам означала бы, что у apex-de после 17 идёт 43, и никто не смог
 * бы объяснить, куда делись остальные.
 */

export class ReleaseNumberingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseNumberingError'
  }
}

export const FIRST_RELEASE_NUMBER = 1

/**
 * Следующий номер релиза для сайта.
 *
 * Пропуски в существующих номерах не «зашиваются»: номер, однажды выданный,
 * больше не выдаётся никогда — даже если релиз с ним провалился. Иначе ссылка
 * на релиз 42 в переписке или в отчёте начинает означать разные вещи в разное
 * время.
 */
export function nextReleaseNumber(existingNumbers: readonly number[]): number {
  if (existingNumbers.length === 0) {
    return FIRST_RELEASE_NUMBER
  }

  let maximum = 0

  for (const value of existingNumbers) {
    if (!Number.isInteger(value) || value < 1) {
      throw new ReleaseNumberingError(
        `Недопустимый номер релиза: ${value}. Номера — целые, начиная с ${FIRST_RELEASE_NUMBER}.`,
      )
    }

    if (value > maximum) {
      maximum = value
    }
  }

  return maximum + 1
}

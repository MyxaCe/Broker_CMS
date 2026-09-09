/**
 * Валидация сборки релиза (ТЗ 3.2, 2.4).
 *
 * Релиз собирается только после чистого отчёта. Это и есть механизм, который
 * не даёт редактору опубликовать состояние, нарушающее контракт, комплаенс или
 * доступность — критерий приёмки разд. 11.
 *
 * Каркас отделён от самих проверок намеренно: проверки приходят из разных
 * модулей (`design` — токены и тексты, `trading` — витрина условий), а порядок
 * их запуска, накопление находок и правило отказа должны быть одни на всех.
 *
 * Живёт в `platform`, а не в `delivery`, хотя запускает его именно сборка
 * релиза. Причина в направлении зависимостей: доменные модули поставляют
 * валидаторы, а импортировать `delivery` им запрещено — иначе `delivery`
 * невозможно выделить в отдельный сервис. Первая версия лежала в `delivery`,
 * и это поймал линтер.
 */

/**
 * `blocking` останавливает сборку, `warning` попадает в отчёт и не мешает.
 *
 * Третьего уровня нет намеренно: «предупреждение, которое на самом деле важно»
 * — это способ протащить нарушение мимо правила. Если нарушение недопустимо,
 * оно блокирующее.
 */
export type FindingSeverity = 'blocking' | 'warning'

export interface Finding {
  readonly validator: string
  readonly severity: FindingSeverity
  /** Машинный код — по нему находят повторяющиеся нарушения между релизами. */
  readonly code: string
  readonly message: string
  /** Где именно: страница, блок, токен. Заполняется по возможности. */
  readonly location?: string
}

/**
 * Что валидатор получил на вход.
 *
 * Существует потому, что «нарушений нет» и «проверять было нечего» выглядят
 * в отчёте одинаково — пустым списком находок, — а означают противоположное.
 * Стоп-словарь месяц отдавал чистый результат просто потому, что до него не
 * доходили тексты: список был пуст, находок не было, отчёт получался
 * безупречным (DEBT-013).
 *
 * Поэтому охват объявляется, а не выводится из числа находок:
 *
 * - `checked` — материал получен и осмотрен, `examined` — сколько единиц;
 * - `empty` — материал получен и его действительно нет (на сайте ни одной
 *   страницы). Проверка отработала, нарушать было нечему;
 * - `missing` — материал **не передан**. Проверка не выполнялась, и её
 *   результат неизвестен. Это блокирующая находка, а не успех.
 */
export type Coverage =
  | { readonly kind: 'checked'; readonly examined: number }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reason: string }

export interface Validator<TInput> {
  readonly name: string
  /** Что и зачем проверяет — попадает в отчёт, который читает редактор. */
  readonly description: string
  run(input: TInput): Finding[]
  /**
   * Что досталось валидатору на вход. Поле обязательное намеренно: сделать его
   * необязательным значило бы разрешить проверке молчать о том, работала ли
   * она, — то есть оставить ровно ту дыру, ради которой охват и заведён.
   */
  coverage(input: TInput): Coverage
}

export interface ValidationReport {
  readonly findings: readonly Finding[]
  readonly blocking: readonly Finding[]
  readonly warnings: readonly Finding[]
  /** Собирать релиз можно только при `true`. */
  readonly passed: boolean
  /** Сколько находок дал каждый валидатор. */
  readonly byValidator: Readonly<Record<string, number>>
  /**
   * Что каждый валидатор получил на вход.
   *
   * Раньше эту роль пытался играть `byValidator`, и делал это неверно: ноль
   * находок у проверки, осмотревшей пятьсот текстов, и ноль находок у
   * проверки, не получившей ни одного, — одно и то же число.
   */
  readonly coverage: Readonly<Record<string, Coverage>>
}

export class ValidatorFailure extends Error {
  constructor(
    readonly validatorName: string,
    readonly reason: unknown,
  ) {
    super(`Валидатор "${validatorName}" завершился ошибкой.`)
    this.name = 'ValidatorFailure'
  }
}

/**
 * Прогоняет все валидаторы и собирает отчёт.
 *
 * Валидаторы выполняются **все**, а не до первой находки: редактор должен
 * увидеть полный список того, что нужно исправить, а не устранять по одной
 * ошибке за прогон.
 *
 * Ошибка внутри валидатора не превращается в «проверка прошла»: она сама
 * становится блокирующей находкой. Иначе сломанная проверка выглядит как
 * отсутствие нарушений — худший из возможных исходов для комплаенса.
 */
export function runValidation<TInput>(
  validators: readonly Validator<TInput>[],
  input: TInput,
): ValidationReport {
  const findings: Finding[] = []
  const byValidator: Record<string, number> = {}
  const coverage: Record<string, Coverage> = {}

  for (const validator of validators) {
    let produced: Finding[]
    let examined: Coverage

    try {
      examined = validator.coverage(input)
      produced = validator.run(input)
    } catch (error) {
      examined = {
        kind: 'missing',
        reason: `валидатор завершился ошибкой: ${error instanceof Error ? error.message : String(error)}`,
      }
      produced = [
        {
          validator: validator.name,
          severity: 'blocking',
          code: 'validator-failed',
          message: `Проверка не выполнилась: ${error instanceof Error ? error.message : String(error)}. Сборка отклонена, потому что результат проверки неизвестен.`,
        },
      ]
    }

    /**
     * Не выполнившаяся проверка обязана быть отличима от пройденной.
     *
     * Без этой ветки проверка, до которой не дошли данные, даёт пустой список
     * находок — то есть отчёт, неотличимый от отчёта чистого сайта. В
     * регулируемой области такой отчёт хуже отсутствующего: на него ссылаются
     * как на доказательство пройденного комплаенса.
     */
    if (examined.kind === 'missing') {
      produced = [
        ...produced,
        {
          validator: validator.name,
          severity: 'blocking',
          code: 'check-not-executed',
          message: `Проверка не выполнялась: ${examined.reason}. Сборка отклонена — результат проверки неизвестен, а не «нарушений нет».`,
        },
      ]
    }

    coverage[validator.name] = examined
    byValidator[validator.name] = produced.length
    findings.push(...produced)
  }

  const blocking = findings.filter((finding) => finding.severity === 'blocking')

  return {
    findings,
    blocking,
    warnings: findings.filter((finding) => finding.severity === 'warning'),
    passed: blocking.length === 0,
    byValidator,
    coverage,
  }
}

/**
 * Приспосабливает валидатор к более широкому входу.
 *
 * Нужно потому, что проверки живут в доменных модулях и знают только про свой
 * кусок: `contrast-aa` — про пары цветов, `forbidden-claims` — про тексты. Знать
 * о снапшоте релиза целиком им незачем, иначе каждая проверка окажется связана
 * со всей моделью публикации.
 */
export function adaptValidator<TOuter, TInner>(
  validator: Validator<TInner>,
  select: (input: TOuter) => TInner,
): Validator<TOuter> {
  return {
    name: validator.name,
    description: validator.description,
    run: (input) => validator.run(select(input)),
    coverage: (input) => validator.coverage(select(input)),
  }
}

/** Краткое человекочитаемое резюме отчёта — то, что видно до раскрытия деталей. */
export function summarizeReport(report: ValidationReport): string {
  const notExecuted = Object.entries(report.coverage).filter(
    ([, coverage]) => coverage.kind === 'missing',
  )

  if (report.passed && report.warnings.length === 0 && notExecuted.length === 0) {
    return 'нарушений нет'
  }

  const parts: string[] = []

  /**
   * Первым — и до чисел: резюме читают вместо отчёта, и «не выполнено» обязано
   * попасть в первую строку, иначе оно теряется среди количеств.
   */
  if (notExecuted.length > 0) {
    parts.push(
      `не выполнено проверок: ${notExecuted.length} (${notExecuted.map(([name]) => name).join(', ')})`,
    )
  }

  if (report.blocking.length > 0) {
    parts.push(`блокирующих: ${report.blocking.length}`)
  }

  if (report.warnings.length > 0) {
    parts.push(`предупреждений: ${report.warnings.length}`)
  }

  return parts.join(', ')
}

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

export interface Validator<TInput> {
  readonly name: string
  /** Что и зачем проверяет — попадает в отчёт, который читает редактор. */
  readonly description: string
  run(input: TInput): Finding[]
}

export interface ValidationReport {
  readonly findings: readonly Finding[]
  readonly blocking: readonly Finding[]
  readonly warnings: readonly Finding[]
  /** Собирать релиз можно только при `true`. */
  readonly passed: boolean
  /** Сколько находок дал каждый валидатор — видно, что вообще отработало. */
  readonly byValidator: Readonly<Record<string, number>>
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

  for (const validator of validators) {
    let produced: Finding[]

    try {
      produced = validator.run(input)
    } catch (error) {
      produced = [
        {
          validator: validator.name,
          severity: 'blocking',
          code: 'validator-failed',
          message: `Проверка не выполнилась: ${error instanceof Error ? error.message : String(error)}. Сборка отклонена, потому что результат проверки неизвестен.`,
        },
      ]
    }

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
  }
}

/** Краткое человекочитаемое резюме отчёта — то, что видно до раскрытия деталей. */
export function summarizeReport(report: ValidationReport): string {
  if (report.passed && report.warnings.length === 0) {
    return 'нарушений нет'
  }

  const parts: string[] = []

  if (report.blocking.length > 0) {
    parts.push(`блокирующих: ${report.blocking.length}`)
  }

  if (report.warnings.length > 0) {
    parts.push(`предупреждений: ${report.warnings.length}`)
  }

  return parts.join(', ')
}

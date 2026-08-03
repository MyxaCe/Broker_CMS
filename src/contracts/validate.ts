import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import errorSchema from './schemas/error.v1.json'
import siteConfigSchema from './schemas/site-config.v1.json'

import type { ValidateFunction } from 'ajv/dist/2020'

/**
 * Валидация ответов схемой (ТЗ разд. 3).
 *
 * Правило одностороннее и жёсткое: **наружу не уходит ничего, что не прошло
 * схему**. Смысл не в аккуратности, а в том, что схема — единственное место,
 * где записана форма ответа. Если код может отдать то, чего в схеме нет, то
 * схема перестаёт быть контрактом и становится документацией.
 *
 * Проверка идёт в рантайме, а не только в типах: типы описывают то, что
 * компилятор видит, а наружу уходит то, что собралось из базы. Между этими
 * двумя вещами и живут расхождения.
 */

export const SCHEMA_IDS = {
  siteConfig: 'site-config.v1',
  error: 'error.v1',
} as const

export type SchemaId = (typeof SCHEMA_IDS)[keyof typeof SCHEMA_IDS]

/**
 * `strict` включён намеренно: ajv тогда ругается на опечатки в самой схеме —
 * неизвестное ключевое слово молча ничего не проверяет, и такая схема выглядит
 * строгой, а не является.
 *
 * `allErrors` — потому что при расхождении контракта нужен полный список, а не
 * первое поле: чинить по одному за прогон дороже, а в проде прогон один.
 */
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true })
addFormats(ajv)

const validators: Record<SchemaId, ValidateFunction> = {
  [SCHEMA_IDS.siteConfig]: ajv.compile(siteConfigSchema),
  [SCHEMA_IDS.error]: ajv.compile(errorSchema),
}

export interface ContractIssue {
  /** Путь до места расхождения в форме JSON Pointer. */
  readonly path: string
  readonly message: string
}

export class ContractViolationError extends Error {
  readonly schemaId: SchemaId
  readonly issues: readonly ContractIssue[]

  constructor(schemaId: SchemaId, issues: readonly ContractIssue[]) {
    super(
      `Ответ не соответствует схеме "${schemaId}":\n  - ${issues
        .map((issue) => `${issue.path === '' ? '(корень)' : issue.path}: ${issue.message}`)
        .join('\n  - ')}`,
    )
    this.name = 'ContractViolationError'
    this.schemaId = schemaId
    this.issues = issues
  }
}

/** Проверяет ответ, ничего не бросая. Для мест, где отказ обрабатывается вручную. */
export function checkAgainstSchema(
  schemaId: SchemaId,
  payload: unknown,
): { readonly valid: boolean; readonly issues: readonly ContractIssue[] } {
  const validate = validators[schemaId]
  const valid = validate(payload)

  if (valid) {
    return { valid: true, issues: [] }
  }

  return {
    valid: false,
    issues: (validate.errors ?? []).map((error) => ({
      path: error.instancePath,
      message: error.message ?? 'не соответствует схеме',
    })),
  }
}

/**
 * Проверяет ответ и возвращает его же — с типом, обещанным контрактом.
 *
 * Бросает при расхождении. Ровно поэтому вызов стоит **последним шагом перед
 * отправкой**: обработчик, поймавший это исключение, обязан ответить ошибкой,
 * а не отдать «почти правильный» ответ.
 */
export function validateOutgoing<T>(schemaId: SchemaId, payload: unknown): T {
  const result = checkAgainstSchema(schemaId, payload)

  if (!result.valid) {
    throw new ContractViolationError(schemaId, result.issues)
  }

  return payload as T
}

import type { SectionRecord } from './resolve'
import type { Payload } from 'payload'

/**
 * Чтение переиспользуемых секций по цепочке наследования (ТЗ 2.2).
 *
 * Вынесено из загрузчика структуры, когда читателей стало двое: сборка
 * структуры и комплаенс-вход. Разбор карточки — имена полей, признак
 * действия, идентификатор владельца — обязан быть один на обоих. Две копии
 * разошлись бы молча: читатель, забывший про `isActive`, видел бы снятую с
 * публикации секцию, а соседний — нет, и один и тот же текст проверялся бы
 * или не проверялся в зависимости от того, кто смотрит. Ровно этот класс мы
 * здесь и закрываем (DEBT-021).
 */

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadSectionRecords(args: {
  readonly payload: Payload
  readonly chainIds: readonly string[]
}): Promise<SectionRecord[]> {
  const found = await args.payload.find({
    collection: 'sections',
    where: { owner: { in: [...args.chainIds] } },
    ...READ,
  })

  return toSectionRecords(found.docs as unknown as Record<string, unknown>[])
}

export function toSectionRecords(docs: readonly Record<string, unknown>[]): SectionRecord[] {
  return docs.map((doc) => ({
    key: typeof doc.key === 'string' ? doc.key : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    ownerId: sectionOwnerId(doc.owner),
    isActive: doc.isActive === true,
    blocks: doc.blocks,
  }))
}

function sectionOwnerId(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return value === null || value === undefined ? '' : String(value)
}

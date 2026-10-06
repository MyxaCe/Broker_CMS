/**
 * Видно ли содержимое в юрисдикции (ТЗ 2.4, 5.4).
 *
 * Правило существовало **только в головах потребителей**. Выдача отдаёт
 * ограничения как есть (`globalAreas[].jurisdictions`, `visibility.jurisdictions`
 * у блока, `jurisdictions` у страницы), а решать, показывать ли, приходится
 * каждому: витрине, кабинету, предпросмотру. Три реализации одного правила
 * расходятся — и расходятся в регуляторной области, где цена расхождения
 * не наша.
 *
 * Здесь оно названо один раз. Предпросмотр (ТЗ 5.4 требует выбора юрисдикции
 * наравне с локалью) пользуется именно этой функцией: предпросмотр, у
 * которого своё правило, показывает не то, что увидит посетитель, — то есть
 * хуже отсутствующего.
 */

export interface VisibilityVerdict {
  readonly visible: boolean
  /** Почему скрыто. `null` — видно. */
  readonly reason: string | null
}

function restrictionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim() !== '') {
      return [entry.trim()]
    }

    /** Payload хранит повторяемую группу объектами `{ code }`. */
    if (entry !== null && typeof entry === 'object' && 'code' in entry) {
      const code = (entry as { code: unknown }).code

      return typeof code === 'string' && code.trim() !== '' ? [code.trim()] : []
    }

    return []
  })
}

export function visibilityIn(
  restrictions: unknown,
  jurisdiction: string | null,
): VisibilityVerdict {
  const list = restrictionsOf(restrictions)

  /**
   * Пустой список — «во всех». Умолчание названо и осознанно: запрет на
   * продукт задаётся явно, а забытое поле ловит отдельное правило комплаенса
   * при сборке релиза (ТЗ 2.4). Обратное умолчание прятало бы содержимое
   * молча, и заметить это было бы некому.
   */
  if (list.length === 0) {
    return { visible: true, reason: null }
  }

  /**
   * Ограничение есть, а юрисдикция неизвестна — **не показываем**.
   *
   * Это несимметричное умолчание, и направление выбрано: «я не знаю, где вы»
   * не является доказательством, что показывать можно. Лишний раз скрытый
   * блок чинят, показанный не там — объясняют регулятору.
   */
  if (jurisdiction === null || jurisdiction === '') {
    return {
      visible: false,
      reason: `Ограничено юрисдикциями (${list.join(', ')}), а юрисдикция не задана: показывать нельзя — неизвестность не разрешение.`,
    }
  }

  if (list.includes(jurisdiction)) {
    return { visible: true, reason: null }
  }

  return {
    visible: false,
    reason: `Ограничено юрисдикциями (${list.join(', ')}) — в «${jurisdiction}» не показывается.`,
  }
}

/** Ограничения блока лежат в `visibility.jurisdictions`, а не в корне узла. */
export function blockVisibilityIn(node: unknown, jurisdiction: string | null): VisibilityVerdict {
  if (node === null || typeof node !== 'object') {
    return { visible: true, reason: null }
  }

  const visibility = (node as { visibility?: unknown }).visibility

  if (visibility === null || typeof visibility !== 'object') {
    return { visible: true, reason: null }
  }

  return visibilityIn((visibility as { jurisdictions?: unknown }).jurisdictions, jurisdiction)
}

export interface FilterResult {
  readonly blocks: unknown[]
  /** Сколько узлов скрыто вместе с потомками. */
  readonly hidden: number
}

/**
 * Прячет из дерева то, что в этой юрисдикции не показывается.
 *
 * Скрытый узел уходит **вместе с потомками**: блок, которого нет, не может
 * содержать видимые колонки. Число скрытого возвращается отдельно — пустая
 * страница и страница, с которой всё убрала юрисдикция, выглядят одинаково,
 * а означают разное.
 */
export function filterByJurisdiction(blocks: unknown, jurisdiction: string | null): FilterResult {
  if (!Array.isArray(blocks)) {
    return { blocks: [], hidden: 0 }
  }

  const kept: unknown[] = []
  let hidden = 0

  for (const node of blocks) {
    if (!blockVisibilityIn(node, jurisdiction).visible) {
      hidden += 1
      continue
    }

    if (node === null || typeof node !== 'object') {
      kept.push(node)
      continue
    }

    const record = node as Record<string, unknown>
    const slots = record.slots

    if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) {
      kept.push(node)
      continue
    }

    const nextSlots: Record<string, unknown> = {}

    for (const [slot, children] of Object.entries(slots as Record<string, unknown>)) {
      const result = filterByJurisdiction(children, jurisdiction)

      nextSlots[slot] = result.blocks
      hidden += result.hidden
    }

    kept.push({ ...record, slots: nextSlots })
  }

  return { blocks: kept, hidden }
}

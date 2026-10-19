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

/**
 * Приводит поле ограничений к списку кодов.
 *
 * Экспортируется намеренно. Ограничения приходят в двух формах: повторяемой
 * группой Payload (`[{ code }]` у областей и страниц) и плоским списком строк
 * (поле JSON у дерева меню). Если бы читающих было двое, они разошлись бы в
 * мелочах — в пробелах, в пустых строках, в чужой форме записи, — и
 * разошлись бы молча: ограничение, прочитанное как пустое, означает «видно
 * всем».
 *
 * Поэтому читает одна функция, и **она же** используется при сборке снапшота,
 * а не только при вычислении видимости.
 */
export function readJurisdictions(value: unknown): string[] {
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
  const list = readJurisdictions(restrictions)

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

/** Пункт меню и его потомки. Форма повторяет `NavItemResponse` в контракте. */
export interface NavVisibilityNode {
  readonly jurisdictions?: unknown
  readonly children?: unknown
}

export interface NavFilterResult<TItem> {
  readonly items: TItem[]
  /** Сколько пунктов скрыто вместе с подпунктами. */
  readonly hidden: number
}

/**
 * Прячет из меню то, что в этой юрисдикции не показывается (Р-045).
 *
 * Отдельная функция от `filterByJurisdiction`, а не обобщение: у блока дети
 * лежат в именованных слотах, у пункта меню — прямо в `children`. Общий код
 * был бы обобщением двух разных форм ради экономии десяти строк — и на этом
 * обобщении легко потерять одну из форм.
 *
 * Скрытый пункт уходит **вместе с подпунктами**: раздела, которого нет, не
 * бывает с видимыми подпунктами. Число скрытого возвращается отдельно —
 * пустое меню и меню, из которого всё убрала юрисдикция, выглядят одинаково,
 * а означают разное.
 *
 * Эта функция — то самое «одно правило на всех» из Р-045: её зовут и витрина,
 * и кабинет, и терминал, и наш собственный предпросмотр. Предпросмотр со
 * своим правилом показывал бы не то, что увидит посетитель, то есть был бы
 * хуже отсутствующего.
 */
export function filterNavByJurisdiction<TItem extends NavVisibilityNode>(
  items: readonly TItem[],
  jurisdiction: string | null,
): NavFilterResult<TItem> {
  /** Поле приходит из JSON: «не список» — это пустое меню, а не исключение. */
  if (!Array.isArray(items)) {
    return { items: [], hidden: 0 }
  }

  const kept: TItem[] = []
  let hidden = 0

  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      continue
    }

    if (!visibilityIn(item.jurisdictions, jurisdiction).visible) {
      hidden += 1
      continue
    }

    const below = filterNavByJurisdiction((item.children ?? []) as readonly TItem[], jurisdiction)
    hidden += below.hidden

    kept.push({ ...item, children: below.items })
  }

  return { items: kept, hidden }
}

import { contrastRatio, meetsAA, parseColor, requiredRatio } from '../contrast'

import { collectContrastPairs } from './contrast-pairs'
import { mergeTokenSets, resolveTokens } from './resolve'
import { THEMES } from './types'

import type { ResolvedTokens } from './resolve'
import type { ComponentToken, Primitive, SemanticRole, Theme, TokenSet } from './types'
import type { ContrastUsage } from '../contrast'

/**
 * Живой предпросмотр палитры при правке токена (ТЗ 2.1, [[DEBT-011]]).
 *
 * Смысл трёхуровневого графа — в направлении правки: меняешь `accent.default`
 * и меняются все кнопки, ссылки и акценты разом. Ровно это и невозможно было
 * увидеть до сохранения. Редактор правил число, сохранял, и узнавал о
 * последствиях либо на витрине, либо отказом сборки релиза по контрасту.
 *
 * Два правила, от которых зависит, будет ли предпросмотр правдой:
 *
 *  · **разрешение то же самое.** Используются `mergeTokenSets`, `resolveTokens`
 *    и `collectContrastPairs` — те, которыми собирается релиз. Своя,
 *    «предпросмотровая» реализация разошлась бы с настоящей, и разошлась бы в
 *    мелочах, из-за которых релиз отказывается собираться уже после зелёного
 *    экрана;
 *  · **сравнение с сохранённым, а не только показ нового.** Число затронутых
 *    токенов и пары, у которых изменился вердикт, — это и есть то, ради чего
 *    предпросмотр существует. Один лишь новый цвет на экране не отвечает на
 *    вопрос «что я этим сломаю».
 */

/** Правка, которую ещё не сохранили. */
export type TokenDraft =
  | { readonly level: 'primitive'; readonly value: Primitive }
  | { readonly level: 'role'; readonly value: SemanticRole }
  | { readonly level: 'component'; readonly value: ComponentToken }

export interface PaletteSwatch {
  readonly name: string
  readonly group: string
  /** Сырое значение по темам. `null` — ссылка не разрешилась. */
  readonly light: string | null
  readonly dark: string | null
  /** Значение отличается от сохранённого — то есть правка его задевает. */
  readonly changed: boolean
  /** Это и есть правимый токен. */
  readonly edited: boolean
}

export interface ContrastRow {
  readonly label: string
  readonly usage: ContrastUsage
  readonly ratio: number
  readonly required: number
  readonly passes: boolean
  /**
   * Чем пара была до правки: `null` — такой пары не было вовсе.
   *
   * Поле существует ради единственного различения, которое здесь имеет
   * значение: пара, **сломанная этой правкой**, и пара, сломанная до неё.
   * Второе чинит не тот, кто сейчас правит токен, и подсвечивать их
   * одинаково значит утопить первое во втором.
   */
  readonly wasPassing: boolean | null
}

export interface PalettePreview {
  readonly swatches: readonly PaletteSwatch[]
  readonly contrast: readonly ContrastRow[]
  /** Расхождения графа: битая ссылка, дубль имени, незаполненная тема. */
  readonly issues: ResolvedTokens['issues']
  /** Сколько разрешённых токенов меняет значение из-за правки. */
  readonly affected: number
  /** Пары, которые эта правка уронила ниже AA. */
  readonly broken: readonly ContrastRow[]
  /** Разрешённые значения по темам — для показа типовых компонентов. */
  readonly byTheme: ResolvedTokens['byTheme']
}

/** Подставляет правку в набор, перекрывая сохранённое значение по имени. */
export function applyDraft(set: TokenSet, draft: TokenDraft | null): TokenSet {
  if (draft === null) {
    return set
  }

  /**
   * Правка кладётся **вторым** набором: `mergeTokenSets` перекрывает по имени,
   * ближний побеждает. Так черновик ведёт себя точно как сохранённое значение
   * того же узла, а не как отдельная сущность со своими правилами.
   */
  const overlay: TokenSet = {
    primitives: draft.level === 'primitive' ? [draft.value] : [],
    roles: draft.level === 'role' ? [draft.value] : [],
    components: draft.level === 'component' ? [draft.value] : [],
  }

  return mergeTokenSets([set, overlay])
}

function isColor(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }

  try {
    parseColor(value)
    return true
  } catch {
    return false
  }
}

function groupOf(set: TokenSet, name: string): string {
  const role = set.roles.find((item) => item.name === name)

  if (role !== undefined) {
    return role.group
  }

  const primitive = set.primitives.find((item) => item.name === name)

  if (primitive !== undefined) {
    return primitive.category
  }

  return 'компонент'
}

function swatchNames(set: TokenSet, resolved: ResolvedTokens): string[] {
  const names = new Set<string>()

  for (const role of set.roles) {
    names.add(role.name)
  }

  for (const primitive of set.primitives) {
    if (primitive.category === 'color') {
      names.add(primitive.name)
    }
  }

  /**
   * Токен компонента попадает в палитру, только если его значение — цвет.
   * `card.radius` в списке образцов занимал бы место и ничего не показывал.
   */
  for (const component of set.components) {
    if (THEMES.some((theme) => isColor(resolved.byTheme[theme][component.name]))) {
      names.add(component.name)
    }
  }

  return [...names].sort()
}

function editedName(draft: TokenDraft | null): string | null {
  return draft === null ? null : draft.value.name
}

export function buildPalettePreview(args: {
  /** Набор по цепочке тенанта, как он сохранён в базе. */
  readonly saved: TokenSet
  readonly draft: TokenDraft | null
}): PalettePreview {
  const savedResolved = resolveTokens(args.saved)
  const next = applyDraft(args.saved, args.draft)
  const resolved = resolveTokens(next)

  const edited = editedName(args.draft)
  const names = swatchNames(next, resolved)

  const swatches: PaletteSwatch[] = []
  let affected = 0

  for (const name of names) {
    const light = resolved.byTheme.light[name] ?? null
    const dark = resolved.byTheme.dark[name] ?? null
    const wasLight = savedResolved.byTheme.light[name] ?? null
    const wasDark = savedResolved.byTheme.dark[name] ?? null
    const changed = light !== wasLight || dark !== wasDark

    if (changed) {
      affected += 1
    }

    swatches.push({
      name,
      group: groupOf(next, name),
      light,
      dark,
      changed,
      edited: name === edited,
    })
  }

  const before = new Map(
    collectContrastPairs(savedResolved).map((pair) => [
      pair.role,
      meetsAA(contrastRatio(pair.foreground, pair.background), pair.usage),
    ]),
  )

  const contrast: ContrastRow[] = collectContrastPairs(resolved).map((pair) => {
    const ratio = contrastRatio(pair.foreground, pair.background)

    return {
      label: pair.role,
      usage: pair.usage,
      ratio,
      required: requiredRatio(pair.usage),
      passes: meetsAA(ratio, pair.usage),
      wasPassing: before.get(pair.role) ?? null,
    }
  })

  return {
    swatches,
    contrast,
    issues: resolved.issues,
    affected,
    /**
     * Сломанной считается пара, которая **проходила до правки**. Пара,
     * не проходившая и раньше, в этот список не попадает: она не последствие
     * этой правки, и смешивать их значит сделать список бесполезным ровно
     * там, где палитру чинят.
     */
    broken: contrast.filter((row) => !row.passes && row.wasPassing === true),
    byTheme: resolved.byTheme,
  }
}

/** Темы в порядке показа — чтобы интерфейс не выдумывал свой. */
export const PREVIEW_THEMES: readonly Theme[] = THEMES

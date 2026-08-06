import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolveTenantById } from './resolve-tenant'

import type { Payload, TypedUser } from 'payload'

/**
 * Доказательство пункта приёмки (ТЗ разд. 11):
 * «редактор сайта A технически не может прочитать или изменить данные сайта B».
 *
 * Модульные тесты проверяют НАШ перевод решения о доступе в условие выборки.
 * Здесь проверяется поведение системы целиком: правила применяются реальным
 * Payload к реальной базе, а `overrideAccess: false` означает, что запрос
 * проходит ровно тот же путь, что и запрос извне.
 *
 * Ключевой сценарий — обращение по ПРЯМОМУ идентификатору. Именно его
 * пропускает фильтр интерфейса, и именно он отличает изоляцию от её видимости.
 */

const PASSWORD = 'integration-test-password-32-chars'

/**
 * Идентификатор хранится как есть, без приведения к строке: в Postgres он
 * числовой, и связь `parent` отвергает строку на валидации. Для сравнений
 * приводим к строке в месте сравнения.
 */
type Id = number | string

let payload: Payload

const ids: Record<'brandApex' | 'regionEu' | 'siteDe' | 'siteAt' | 'brandOther' | 'siteRu', Id> = {
  brandApex: 0,
  regionEu: 0,
  siteDe: 0,
  siteAt: 0,
  brandOther: 0,
  siteRu: 0,
}

const users: Record<string, TypedUser> = {}

/**
 * Очистка по одному документу, а не пакетным `delete({ where: {} })`.
 *
 * Пакетное удаление с пустым условием роняет построитель связанных запросов
 * drizzle. Поштучное удаление медленнее, но на объёме фикстуры это доли
 * секунды, а поведение предсказуемо.
 */
type WipeableCollection =
  | 'users'
  | 'tenants'
  | 'articles'
  | 'videos'
  | 'promos'
  | 'media'
  | 'categories'
  | 'tags'
  | 'authors'
  | 'design-primitives'
  | 'design-roles'
  | 'design-component-tokens'
  | 'pages'

async function wipeCollection(collection: WipeableCollection): Promise<void> {
  const existing = await payload.find({
    collection,
    pagination: false,
    overrideAccess: true,
    depth: 0,
  })

  for (const doc of existing.docs) {
    await payload.delete({ collection, id: doc.id, overrideAccess: true })
  }
}

/**
 * Порядок обязателен и идёт от зависимого к тому, от чего зависят.
 *
 * Тенант с материалами не удаляется — и это правильное поведение, а не помеха
 * тесту: обязательная связь не обнуляется, поэтому удаление сайта с новостями
 * невозможно by design. Здесь фикстура сносится целиком, значит сносить надо
 * в правильном порядке.
 */
async function wipe(): Promise<void> {
  await wipeCollection('pages')
  await wipeCollection('articles')
  await wipeCollection('videos')
  await wipeCollection('promos')
  await wipeCollection('media')
  await wipeCollection('categories')
  await wipeCollection('tags')
  await wipeCollection('authors')
  await wipeCollection('design-component-tokens')
  await wipeCollection('design-roles')
  await wipeCollection('design-primitives')
  await wipeCollection('users')
  await wipeCollection('tenants')
}

async function createTenant(data: Record<string, unknown>): Promise<Id> {
  const doc = await payload.create({
    collection: 'tenants',
    data: data as never,
    overrideAccess: true,
  })
  return doc.id
}

async function createUser(
  key: string,
  data: { role: string; tenants: Id[]; isActive?: boolean },
): Promise<void> {
  const doc = await payload.create({
    collection: 'users',
    data: {
      email: `${key}@example.test`,
      password: PASSWORD,
      fullName: key,
      role: data.role,
      tenants: data.tenants,
      isActive: data.isActive ?? true,
    } as never,
    overrideAccess: true,
  })

  users[key] = doc as TypedUser
}

/** Отказ доступа в Payload приходит исключением — важен сам факт, не его текст. */
async function isDenied(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation()
    return false
  } catch {
    return true
  }
}

beforeAll(async () => {
  payload = await getPayload({ config })
  await wipe()

  /**
   * Фикстура выстроена так, чтобы наследование было видно:
   * бренд даёт локаль `en`, регион — юрисдикцию, локаль `de` и локаль по
   * умолчанию, сайт `apex-de` переопределяет юрисдикцию, а `apex-at` не задаёт
   * ничего и живёт целиком на унаследованном.
   */
  ids.brandApex = await createTenant({
    name: 'Apex',
    slug: 'apex',
    kind: 'brand',
    availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
  })
  ids.regionEu = await createTenant({
    name: 'Apex EU',
    slug: 'apex-eu',
    kind: 'region',
    parent: ids.brandApex,
    jurisdiction: { mode: 'override', value: 'eu-mifid' },
    availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
    defaultLocale: { mode: 'override', value: 'de' },
  })
  ids.siteDe = await createTenant({
    name: 'Apex Germany',
    slug: 'apex-de',
    kind: 'site',
    parent: ids.regionEu,
    jurisdiction: { mode: 'override', value: 'de-bafin' },
  })
  ids.siteAt = await createTenant({
    name: 'Apex Austria',
    slug: 'apex-at',
    kind: 'site',
    parent: ids.regionEu,
  })

  // Второй бренд — проверка, что поддерево не протекает вбок.
  ids.brandOther = await createTenant({ name: 'Other', slug: 'other', kind: 'brand' })
  ids.siteRu = await createTenant({
    name: 'Other RU',
    slug: 'other-ru',
    kind: 'site',
    parent: ids.brandOther,
    jurisdiction: { mode: 'override', value: 'ru-cbr' },
    availableLocales: { mode: 'extend', items: [{ code: 'ru' }] },
    defaultLocale: { mode: 'override', value: 'ru' },
  })

  await createUser('editor-de', { role: 'editor', tenants: [ids.siteDe] })
  await createUser('editor-at', { role: 'editor', tenants: [ids.siteAt] })
  await createUser('region-editor', { role: 'editor', tenants: [ids.regionEu] })
  await createUser('brand-admin', { role: 'brand-admin', tenants: [] })
  await createUser('brand-admin-off', { role: 'brand-admin', tenants: [], isActive: false })
})

describe('изоляция тенантов: чтение', () => {
  it('редактор сайта видит только свой сайт', async () => {
    const result = await payload.find({
      collection: 'tenants',
      overrideAccess: false,
      user: users['editor-de'],
      pagination: false,
    })

    expect(result.docs.map((doc) => String(doc.id))).toEqual([String(ids.siteDe)])
  })

  it('редактор сайта A не получает данные сайта B ПО ПРЯМОМУ ИДЕНТИФИКАТОРУ', async () => {
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'tenants',
        id: ids.siteAt,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied, 'прямое обращение по id обошло изоляцию').toBe(true)
  })

  it('редактор не видит чужой бренд', async () => {
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'tenants',
        id: ids.siteRu,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('привязка к региону разворачивается в его сайты, но не дальше', async () => {
    const result = await payload.find({
      collection: 'tenants',
      overrideAccess: false,
      user: users['region-editor'],
      pagination: false,
    })

    const visible = result.docs.map((doc) => String(doc.id)).sort()
    expect(visible).toEqual([ids.regionEu, ids.siteAt, ids.siteDe].map(String).sort())
    expect(visible).not.toContain(String(ids.siteRu))
    expect(visible).not.toContain(String(ids.brandApex))
  })

  it('кросс-тенантная роль видит всё', async () => {
    const result = await payload.find({
      collection: 'tenants',
      overrideAccess: false,
      user: users['brand-admin'],
      pagination: false,
    })

    expect(result.docs).toHaveLength(6)
  })

  /**
   * Отказ приходит исключением `Forbidden`, а не пустой выборкой: запрос
   * отклоняется до обращения к базе. Это строже, чем «ничего не нашлось», —
   * и именно так и должно быть, поэтому проверяем факт отказа.
   */
  it('отключённая кросс-тенантная роль получает отказ', async () => {
    const denied = await isDenied(() =>
      payload.find({
        collection: 'tenants',
        overrideAccess: false,
        user: users['brand-admin-off'],
        pagination: false,
      }),
    )

    expect(denied).toBe(true)
  })

  it('анонимный запрос получает отказ', async () => {
    const denied = await isDenied(() =>
      payload.find({ collection: 'tenants', overrideAccess: false, pagination: false }),
    )

    expect(denied).toBe(true)
  })
})

describe('изоляция тенантов: изменение', () => {
  it('редактор не может изменить чужой сайт', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'tenants',
        id: ids.siteAt,
        data: { name: 'Захвачено' },
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('редактор не может удалить чужой сайт', async () => {
    const denied = await isDenied(() =>
      payload.delete({
        collection: 'tenants',
        id: ids.siteAt,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('редактор не может создать тенанта', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'tenants',
        data: { name: 'Свой', slug: 'own', kind: 'brand' } as never,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('чужой сайт остался нетронутым после всех попыток', async () => {
    const doc = await payload.findByID({
      collection: 'tenants',
      id: ids.siteAt,
      overrideAccess: true,
    })

    expect(doc.name).toBe('Apex Austria')
  })
})

describe('учётные записи', () => {
  it('редактор видит только пользователей своего тенанта', async () => {
    const result = await payload.find({
      collection: 'users',
      overrideAccess: false,
      user: users['editor-de'],
      pagination: false,
    })

    expect(result.docs.map((doc) => doc.email)).toEqual(['editor-de@example.test'])
  })

  it('редактор не получает чужую учётную запись по прямому идентификатору', async () => {
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'users',
        id: users['editor-at']!.id,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('редактор может править свою карточку', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: users['editor-de']!.id,
      data: { fullName: 'Новое имя' },
      overrideAccess: false,
      user: users['editor-de'],
    })

    expect(updated.fullName).toBe('Новое имя')
  })

  it('редактор НЕ может повысить себе роль', async () => {
    await isDenied(() =>
      payload.update({
        collection: 'users',
        id: users['editor-de']!.id,
        data: { role: 'brand-admin' },
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    const after = await payload.findByID({
      collection: 'users',
      id: users['editor-de']!.id,
      overrideAccess: true,
    })

    expect(after.role, 'редактор изменил себе роль — повышение полномочий').toBe('editor')
  })

  it('редактор НЕ может расширить себе привязку к тенантам', async () => {
    await isDenied(() =>
      payload.update({
        collection: 'users',
        id: users['editor-de']!.id,
        data: { tenants: [ids.siteDe, ids.siteAt] } as never,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    const after = await payload.findByID({
      collection: 'users',
      id: users['editor-de']!.id,
      overrideAccess: true,
      depth: 0,
    })

    expect(
      (after.tenants ?? []).map((value: unknown) => String(value)),
      'редактор расширил себе доступ',
    ).toEqual([String(ids.siteDe)])
  })

  it('редактор не может завести учётную запись', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'users',
        data: {
          email: 'impostor@example.test',
          password: PASSWORD,
          fullName: 'Подставной',
          role: 'brand-admin',
          tenants: [],
          isActive: true,
        } as never,
        overrideAccess: false,
        user: users['editor-de'],
      }),
    )

    expect(denied).toBe(true)
  })

  it('учётная запись без привязки не сохраняется', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'users',
        data: {
          email: 'unbound@example.test',
          password: PASSWORD,
          fullName: 'Без привязки',
          role: 'editor',
          tenants: [],
          isActive: true,
        } as never,
        overrideAccess: true,
      }),
    )

    expect(denied, 'сохранена учётная запись, которая не увидит ни одного тенанта').toBe(true)
  })
})

describe('наследование по цепочке', () => {
  it('сайт без собственных настроек живёт на унаследованных', async () => {
    const settings = await resolveTenantById(payload, ids.siteAt)

    expect(settings.jurisdiction.value).toBe('eu-mifid')
    expect(settings.jurisdiction.provenance).toBe('inherited')
    expect(String(settings.jurisdiction.sourceTenantId)).toBe(String(ids.regionEu))

    // Локали накопились: `en` от бренда, `de` от региона.
    expect(settings.availableLocales.entries.map((entry) => entry.value)).toEqual(['de', 'en'])
    expect(settings.defaultLocale.value).toBe('de')
  })

  it('сайт переопределяет юрисдикцию, но видит унаследованное значение', async () => {
    const settings = await resolveTenantById(payload, ids.siteDe)

    expect(settings.jurisdiction.value).toBe('de-bafin')
    expect(settings.jurisdiction.provenance).toBe('overridden')
    // То, к чему вернётся поле по кнопке «вернуть к наследуемому».
    expect(settings.jurisdiction.inheritedValue).toBe('eu-mifid')
  })

  it('изменение региона доезжает до сайта, который его наследует', async () => {
    await payload.update({
      collection: 'tenants',
      id: ids.regionEu,
      data: { jurisdiction: { mode: 'override', value: 'eu-mifid-2' } } as never,
      overrideAccess: true,
    })

    const settings = await resolveTenantById(payload, ids.siteAt)

    expect(settings.jurisdiction.value).toBe('eu-mifid-2')

    await payload.update({
      collection: 'tenants',
      id: ids.regionEu,
      data: { jurisdiction: { mode: 'override', value: 'eu-mifid' } } as never,
      overrideAccess: true,
    })
  })
})

describe('целостность цепочки', () => {
  it('сайт без юрисдикции — ни своей, ни унаследованной — не сохраняется', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'tenants',
        data: {
          name: 'Без юрисдикции',
          slug: 'no-jurisdiction',
          kind: 'site',
          // Бренд `apex` юрисдикции не задаёт — наследовать нечего.
          parent: ids.brandApex,
          availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
          defaultLocale: { mode: 'override', value: 'de' },
        } as never,
        overrideAccess: true,
      }),
    )

    expect(denied).toBe(true)
  })

  it('сайт с унаследованной юрисдикцией сохраняется без собственной', async () => {
    const created = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Apex Netherlands',
        slug: 'apex-nl',
        kind: 'site',
        parent: ids.regionEu,
      } as never,
      overrideAccess: true,
    })

    expect(created.id).toBeTruthy()
    await payload.delete({ collection: 'tenants', id: created.id, overrideAccess: true })
  })

  it('бренд с родителем не сохраняется', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'tenants',
        data: {
          name: 'Под-бренд',
          slug: 'sub-brand',
          kind: 'brand',
          parent: ids.brandApex,
        } as never,
        overrideAccess: true,
      }),
    )

    expect(denied).toBe(true)
  })
})

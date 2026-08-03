import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { ensureEnv } from '@/platform'

import { issueDeliveryKey, verifyDeliveryKey } from './issue'

import type { Payload } from 'payload'

/**
 * Ключи доставки на живой базе (ТЗ разд. 6).
 *
 * Проверяемое утверждение: **выданный ключ работает, а всё остальное — нет**,
 * и ни при каких условиях секрет не хранится в открытом виде.
 */

let payload: Payload
let pepper: string
let siteId: string
let otherSiteId: string
let issuedPlaintext: string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })
  pepper = ensureEnv().DELIVERY_KEY_PEPPER

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Ключи — бренд',
      slug: `keys-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Ключи — сайт',
      slug: `keys-site-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  const other = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Ключи — чужой сайт',
      slug: `keys-other-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  siteId = String(site.id)
  otherSiteId = String(other.id)

  const issued = await issueDeliveryKey({
    payload,
    pepper,
    name: 'Тестовый ключ сайта',
    scopes: ['delivery:read'],
    siteIds: [site.id],
  })

  issuedPlaintext = issued.plaintext
})

async function verify(overrides: Partial<Parameters<typeof verifyDeliveryKey>[0]> = {}) {
  return verifyDeliveryKey({
    payload,
    pepper,
    authorizationHeader: `Bearer ${issuedPlaintext}`,
    requiredScope: 'delivery:read',
    siteId,
    ...overrides,
  })
}

describe('выданный ключ работает', () => {
  it('верный ключ на своём сайте разрешён', async () => {
    const decision = await verify()

    expect(decision.kind).toBe('allow')
  })
})

describe('секрет не хранится в открытом виде', () => {
  it('в записи ключа нет предъявленного значения', async () => {
    const found = await payload.find({
      collection: 'delivery-keys',
      where: { name: { equals: 'Тестовый ключ сайта' } },
      pagination: false,
      overrideAccess: true,
    })

    const dump = JSON.stringify(found.docs)
    const secret = issuedPlaintext.split('_').slice(2).join('_')

    expect(dump).not.toContain(secret)
    expect(dump).not.toContain(issuedPlaintext)
  })

  /**
   * Отпечаток бесполезен без «перца», но незачем отдавать и его: утечка
   * отпечатков сокращает работу подбора ровно на один шаг.
   */
  it('отпечаток не отдаётся наружу даже кросс-тенантной роли', async () => {
    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `keys-admin-${stamp}@example.test`,
        password: 'keys-integration-password-32ch!',
        fullName: 'Ключи-админ',
        role: 'developer',
        tenants: [],
        isActive: true,
      } as never,
      overrideAccess: true,
    })

    const found = await payload.find({
      collection: 'delivery-keys',
      where: { name: { equals: 'Тестовый ключ сайта' } },
      pagination: false,
      overrideAccess: false,
      user: admin as never,
    })

    expect(JSON.stringify(found.docs)).not.toContain('secretHash')
  })
})

describe('всё остальное не работает', () => {
  it('отсутствие заголовка — отказ', async () => {
    expect(await verify({ authorizationHeader: null })).toEqual({
      kind: 'deny',
      reason: 'missing-header',
    })
  })

  it('несуществующий ключ — отказ', async () => {
    const decision = await verify({
      authorizationHeader: 'Bearer bkc_0123456789abcdef01_0123456789abcdef0123456789',
    })

    expect(decision).toEqual({ kind: 'deny', reason: 'unknown-key' })
  })

  it('подменённый секрет при верном идентификаторе — отказ', async () => {
    const [prefix, keyId] = issuedPlaintext.split('_')
    const forged = `${prefix}_${keyId}_${'a'.repeat(43)}`

    expect(await verify({ authorizationHeader: `Bearer ${forged}` })).toEqual({
      kind: 'deny',
      reason: 'bad-secret',
    })
  })

  it('чужой сайт — отказ', async () => {
    expect(await verify({ siteId: otherSiteId })).toEqual({
      kind: 'deny',
      reason: 'site-not-allowed',
    })
  })

  it('недостающий скоуп — отказ', async () => {
    expect(await verify({ requiredScope: 'terminal:read' })).toEqual({
      kind: 'deny',
      reason: 'missing-scope',
    })
  })

  it('отозванный ключ перестаёт работать', async () => {
    const found = await payload.find({
      collection: 'delivery-keys',
      where: { name: { equals: 'Тестовый ключ сайта' } },
      pagination: false,
      overrideAccess: true,
    })

    await payload.update({
      collection: 'delivery-keys',
      id: found.docs[0]!.id,
      data: { isActive: false } as never,
      overrideAccess: true,
    })

    expect(await verify()).toEqual({ kind: 'deny', reason: 'inactive' })

    await payload.update({
      collection: 'delivery-keys',
      id: found.docs[0]!.id,
      data: { isActive: true } as never,
      overrideAccess: true,
    })
  })
})

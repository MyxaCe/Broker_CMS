import config from '@payload-config'
import { cookies as requestCookies } from 'next/headers'
import { getPayload } from 'payload'

import { loadPreview, PageView, PreviewError } from '@/modules/design'
import { verifyDeliveryKey } from '@/modules/delivery'
import { ensureEnv, isCrossTenantActor, resolveEffectiveAccess, toActor } from '@/platform'

import './preview.css'

import type { TenantNode } from '@/platform'

/**
 * Предпросмотр чернового пространства (ТЗ 5.4).
 *
 * Отдельная поверхность, не витрина: витрина — стороннее приложение, живущее
 * рядом. Здесь показывается то, что ещё не опубликовано, и показывается так
 * же, как это увидит потребитель, — теми же токенами, той же структурой, тем
 * же раскрытием секций.
 */

export const dynamic = 'force-dynamic'

interface PreviewParams {
  readonly params: Promise<{ site: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PreviewPage({
  params,
  searchParams,
}: PreviewParams): Promise<React.JSX.Element> {
  const { site } = await params
  const query = await searchParams

  const payload = await getPayload({ config })
  const path = single(query.path)
  const locale = single(query.locale)
  const theme = single(query.theme) === 'dark' ? 'dark' : 'light'

  let result

  try {
    result = await loadPreview({ payload, siteSlug: site, path, locale, theme })
  } catch (error) {
    if (error instanceof PreviewError) {
      return <Refusal title="Предпросмотр недоступен" text={error.message} />
    }

    throw error
  }

  const allowed = await authorize({ payload, siteId: result.site.id, token: single(query.token) })

  if (!allowed) {
    /**
     * Причина отказа наружу не уточняется: по разнице между «нет доступа» и
     * «нет сайта» перечень сайтов узнаётся без единого ключа. То же правило,
     * что и в выдаче.
     */
    return (
      <Refusal
        title="Предпросмотр недоступен"
        text="Нужен вход в админку с доступом к этому сайту или действующий preview-токен."
      />
    )
  }

  if (result.page === null) {
    return (
      <Refusal
        title="Страница не найдена"
        text={`На сайте «${result.site.title}» нет страницы с таким путём на языке ${result.locale}.`}
      />
    )
  }

  return (
    <div className="pv-root" data-theme={theme}>
      <PreviewBar result={result} theme={theme} />
      <PageView
        page={result.page}
        navigation={result.navigation}
        areas={result.areas}
        tokens={result.tokens}
      />
    </div>
  )
}

/**
 * Доступ к предпросмотру.
 *
 * Два пути, и оба сильнее ключа витрины:
 *
 *  · **preview-токен** — ключ доставки со скоупом `preview:read`, привязанный
 *    к этому сайту. Ровно то, чего требует ТЗ: «отдельный preview-токен, НЕ
 *    основной API-ключ»;
 *  · **сессия админки** с доступом к этому сайту. Формально ТЗ говорит про
 *    токен, но сессия редактора — более сильное удостоверение, чем токен, и
 *    требовать от редактора генерировать ключ ради взгляда на свою же
 *    страницу значило бы, что предпросмотром не пользуются.
 *
 * Ключ витрины (`delivery:read`) не подходит ни в каком случае: он раздан
 * потребителям, и неопубликованное он открывать не должен.
 */
async function authorize(args: {
  readonly payload: Awaited<ReturnType<typeof getPayload>>
  readonly siteId: string
  readonly token: string | null
}): Promise<boolean> {
  if (args.token !== null && args.token !== '') {
    const decision = await verifyDeliveryKey({
      payload: args.payload,
      pepper: ensureEnv().DELIVERY_KEY_PEPPER,
      authorizationHeader: `Bearer ${args.token}`,
      requiredScope: 'preview:read',
      siteId: args.siteId,
    })

    if (decision.kind === 'allow') {
      return true
    }
  }

  const { user } = await args.payload.auth({ headers: await sessionHeaders() })
  const actor = toActor(user)

  if (actor === null) {
    return false
  }

  if (isCrossTenantActor(user)) {
    return true
  }

  const nodes = await loadTenantNodes(args.payload)
  const decision = resolveEffectiveAccess(actor, nodes)

  return (
    decision.kind === 'allow-all' ||
    (decision.kind === 'allow-tenants' && decision.tenantIds.includes(args.siteId))
  )
}

/**
 * Сессия редактора для `payload.auth` — из cookie, но заголовком.
 *
 * Пересобирается намеренно. Payload принимает cookie только вместе с
 * заголовком `Origin`: это защита от подделки межсайтовых запросов, и для
 * запросов, меняющих данные, она правильная. Но предпросмотр открывают
 * **переходом по ссылке**, а браузер при обычной навигации `Origin` не шлёт —
 * и сессия выглядела бы как её отсутствие.
 *
 * Обход здесь безопасен ровно потому, что страница только читает: чужой сайт,
 * заставивший браузер её открыть, не сможет прочитать ответ — ни навигация, ни
 * запрос без CORS его содержимое не отдают.
 */
async function sessionHeaders(): Promise<Headers> {
  const token = (await requestCookies()).get('payload-token')?.value

  return new Headers(token === undefined ? {} : { Authorization: `JWT ${token}` })
}

async function loadTenantNodes(
  payload: Awaited<ReturnType<typeof getPayload>>,
): Promise<Map<string, TenantNode>> {
  const result = await payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const nodes = new Map<string, TenantNode>()

  for (const doc of result.docs as unknown as Record<string, unknown>[]) {
    const kind = doc.kind

    if (kind !== 'brand' && kind !== 'region' && kind !== 'site') {
      continue
    }

    const parent = doc.parent

    nodes.set(String(doc.id), {
      id: String(doc.id),
      slug: typeof doc.slug === 'string' ? doc.slug : '',
      kind,
      parentId:
        parent === null || parent === undefined
          ? null
          : typeof parent === 'object' && 'id' in parent
            ? String((parent as { id: unknown }).id)
            : String(parent),
    })
  }

  return nodes
}

/** Полоса управления предпросмотром: язык, тема, выбор страницы. */
function PreviewBar({
  result,
  theme,
}: {
  readonly result: Awaited<ReturnType<typeof loadPreview>>
  readonly theme: string
}): React.JSX.Element {
  const link = (params: Record<string, string>): string => {
    const search = new URLSearchParams({
      path: result.page?.path ?? '/',
      locale: result.locale,
      theme,
      ...params,
    })

    return `?${search.toString()}`
  }

  return (
    <div className="pv-bar">
      <span className="pv-bar__title">
        {result.site.title}
        {result.page === null ? '' : ` · ${result.page.title}`}
      </span>

      {/*
       * Состояние страницы показано крупно: предпросмотр черновика легко
       * принять за опубликованную страницу, и тогда «почему на сайте не так»
       * становится вопросом на полдня.
       */}
      {result.page === null ? null : (
        <span className={`pv-bar__status pv-bar__status--${result.page.status}`}>
          {result.page.status === 'published' ? 'опубликована' : 'черновик'}
        </span>
      )}

      <span className="pv-bar__group">
        {result.availableLocales.map((code) => (
          <a
            key={code}
            className={`pv-bar__link${code === result.locale ? ' pv-bar__link--on' : ''}`}
            href={link({ locale: code })}
          >
            {code}
          </a>
        ))}
      </span>

      <span className="pv-bar__group">
        <a
          className={`pv-bar__link${theme === 'light' ? ' pv-bar__link--on' : ''}`}
          href={link({ theme: 'light' })}
        >
          светлая
        </a>
        <a
          className={`pv-bar__link${theme === 'dark' ? ' pv-bar__link--on' : ''}`}
          href={link({ theme: 'dark' })}
        >
          тёмная
        </a>
      </span>

      <select className="pv-bar__select" defaultValue={result.page?.path ?? ''} disabled>
        {result.paths.map((entry) => (
          <option key={entry.path} value={entry.path}>
            {entry.path} — {entry.title}
          </option>
        ))}
      </select>
    </div>
  )
}

function Refusal({
  title,
  text,
}: {
  readonly title: string
  readonly text: string
}): React.JSX.Element {
  return (
    <div className="pv-refusal">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  )
}

function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value === undefined || value === '' ? null : value
}

/**
 * Проба живости.
 *
 * Данных не отдаёт и ключа не требует — иначе проба перестаёт работать ровно
 * тогда, когда она нужнее всего: при проблемах с конфигурацией ключей.
 *
 * Того, что могло бы пригодиться атакующему, здесь нет: ни версии сборки, ни
 * состояния зависимостей, ни имён сайтов. Проверка глубже — задача мониторинга,
 * который ходит с ключом.
 */

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

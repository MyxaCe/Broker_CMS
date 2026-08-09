import { isCrossTenantActor } from '@/platform'

import { validateBlockTree } from './validate-tree'

import type { PayloadRequest } from 'payload'

/**
 * Проверка дерева блоков при сохранении.
 *
 * Появилась из дыры, а не из осторожности: `validateBlockTree` был написан и
 * покрыт тестами, но **не вызывался ниоткуда**. Реестр проверял типы только на
 * словах — в комментарии коллекции, — а на деле поле принимало что угодно.
 * Нашлось при подключении конструктора: форма выводит расхождения, а сохранение
 * их пропускало.
 *
 * Роли токенов здесь неизвестны: они разрешаются по цепочке тенанта, и читать
 * её на каждое сохранение дорого. Поэтому ссылки на семантические роли
 * проверяет сборка релиза, а сохранение — всё остальное: состав, пропсы,
 * варианты, вложенность, ограниченные блоки.
 */
export function assertBlockTree(blocks: unknown, req: PayloadRequest, where: string): void {
  const issues = validateBlockTree(blocks, {
    roles: new Set<string>(),
    /**
     * Произвольная разметка — только кросс-тенантной роли. Проверка стоит на
     * сохранении, а не только на сборке: иначе редактор узнал бы об отказе
     * через день, при публикации.
     */
    allowRestricted: isCrossTenantActor(req.user),
  })

  if (issues.length === 0) {
    return
  }

  throw new Error(
    `${where} не сохранены: ${issues.map((issue) => `${issue.path} — ${issue.message}`).join('; ')}`,
  )
}

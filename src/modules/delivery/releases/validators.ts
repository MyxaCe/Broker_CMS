import {
  brandAssetsValidator,
  complianceValidator,
  contrastValidator,
  forbiddenClaimsValidator,
  routingValidator,
  structureValidator,
  tokenGraphValidator,
} from '@/modules/design'
import { adaptValidator } from '@/platform'

import type { ReleaseSnapshot } from './snapshot'
import type { Validator } from '@/platform'

/**
 * Набор валидаторов сборки релиза (ТЗ 3.2).
 *
 * Проверки приходят из доменных модулей и знают только про свой кусок; здесь
 * они приспосабливаются к снапшоту. Так проверка контраста не оказывается
 * связана со всей моделью публикации.
 */

/**
 * Готовность сайта к публикации.
 *
 * Дублирует проверку, которая уже стоит на сохранении тенанта, — и это не
 * лишнее: карточка могла быть сохранена до появления правила, а предок мог
 * измениться после. Сборка обязана проверять состояние **на момент сборки**,
 * а не доверять тому, что когда-то оно было корректным.
 */
export const siteReadinessValidator: Validator<ReleaseSnapshot> = {
  name: 'site-readiness',
  description: 'Юрисдикция и локали разрешены для сайта (ТЗ 3.4, ADR-0003).',

  run(snapshot) {
    if (snapshot.site.kind !== 'site') {
      return [
        {
          validator: 'site-readiness',
          severity: 'blocking' as const,
          code: 'not-a-site',
          message: `Релиз собирается только для сайта, а не для уровня «${snapshot.site.kind}».`,
          location: snapshot.site.slug,
        },
      ]
    }

    const findings = []

    if (snapshot.settings.jurisdiction.value === null) {
      findings.push({
        validator: 'site-readiness',
        severity: 'blocking' as const,
        code: 'jurisdiction-missing',
        message:
          'Юрисдикция не разрешена ни на сайте, ни выше по цепочке — обязательные предупреждения и запрещённые продукты определить невозможно.',
        location: snapshot.site.slug,
      })
    }

    if (snapshot.settings.availableLocales.length === 0) {
      findings.push({
        validator: 'site-readiness',
        severity: 'blocking' as const,
        code: 'locales-missing',
        message: 'У сайта нет ни одной локали — ни своей, ни унаследованной.',
        location: snapshot.site.slug,
      })
    }

    /**
     * Стартовый демо-баланс — предупреждение, а не блокировка (Р-027).
     *
     * Сайт без демо-счёта существует, и останавливать из-за этого публикацию
     * нельзя. Но legacy отдаёт величину сегодня, подставляя её умолчанием, —
     * и переезд на v2 оставит кабинет без неё молча, если об этом не сказать
     * в отчёте.
     */
    if (snapshot.settings.demoStartBalanceCents === null) {
      findings.push({
        validator: 'site-readiness',
        severity: 'warning' as const,
        code: 'demo-balance-missing',
        message:
          'Стартовый баланс демо-счёта не задан ни на сайте, ни выше по цепочке. Выдача отдаст null — кабинет обязан отказать, а не подставить своё число.',
        location: snapshot.site.slug,
      })
    }

    const defaultLocale = snapshot.settings.defaultLocale.value

    if (defaultLocale === null) {
      findings.push({
        validator: 'site-readiness',
        severity: 'blocking' as const,
        code: 'default-locale-missing',
        message: 'Не разрешена локаль по умолчанию.',
        location: snapshot.site.slug,
      })
    } else if (!snapshot.settings.availableLocales.includes(defaultLocale)) {
      findings.push({
        validator: 'site-readiness',
        severity: 'blocking' as const,
        code: 'default-locale-not-available',
        message: `Локаль по умолчанию «${defaultLocale}» отсутствует среди разрешённых (${snapshot.settings.availableLocales.join(', ')}).`,
        location: snapshot.site.slug,
      })
    }

    return findings
  },

  /**
   * Единственная проверка, которой всегда есть что смотреть: снапшот сайта
   * существует всегда, иначе сборка не началась бы.
   */
  coverage() {
    return { kind: 'checked', examined: 1 }
  },
}

/**
 * Порядок значим для читаемости отчёта: сначала то, без чего сайт вообще не
 * существует, затем доступность, затем тексты.
 */
export const RELEASE_VALIDATORS: readonly Validator<ReleaseSnapshot>[] = [
  siteReadinessValidator,
  /**
   * Целостность графа токенов — до контраста: у набора с битой ссылкой роль
   * не имеет значения, и проверять её контраст не с чем. Сообщение «контраст
   * не сошёлся» на отсутствующем цвете сбивало бы с толку.
   */
  adaptValidator(tokenGraphValidator, (snapshot) => ({
    tokenIssues: snapshot.tokenIssues,
    examined: snapshot.examined.tokens,
  })),
  adaptValidator(contrastValidator, (snapshot) => ({ colorPairs: snapshot.colorPairs })),
  /**
   * Брендовые ассеты — рядом с токенами: это тот же слой А, и находки у них
   * одной природы — «витрина получит не то, что обещано дизайн-системой».
   */
  adaptValidator(brandAssetsValidator, (snapshot) => ({ brand: snapshot.brand })),
  adaptValidator(forbiddenClaimsValidator, (snapshot) => ({ texts: snapshot.texts })),
  /**
   * Структура — после токенов и до комплаенса: её находки говорят о том, чего
   * на витрине не окажется, и читать их проще рядом с остальными техническими
   * расхождениями, а не после комплаенс-нарушений.
   */
  adaptValidator(structureValidator, (snapshot) => ({
    structureFindings: snapshot.structure.findings,
    examined: snapshot.examined.structureNodes,
  })),
  adaptValidator(routingValidator, (snapshot) => ({
    routingFindings: snapshot.routing.findings,
    examined: snapshot.examined.routedPages,
  })),
  /**
   * Комплаенс — последним: его находки самые дорогие для чтения, и показывать
   * их поверх списка технических расхождений значило бы утопить главное.
   */
  adaptValidator(complianceValidator, (snapshot) => ({
    complianceFindings: snapshot.complianceFindings,
    examined: snapshot.examined.compliancePages,
  })),
]

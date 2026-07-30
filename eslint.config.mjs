// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Границы модулей принуждаются линтером, а не соглашением (ТЗ разд. 9, TASK-003).
 * Нарушение роняет CI — см. .github/workflows/ci.yml.
 */

/** Публичный интерфейс: `@/modules/stream` можно, `@/modules/stream/что-угодно` нельзя. */
const publicInterfaceOnly = [
  {
    group: ['@/modules/*/**'],
    message:
      'Только публичный интерфейс модуля: импортируйте "@/modules/<имя>", а не его внутренности. ТЗ разд. 9.',
  },
  {
    group: ['@/platform/*/**'],
    message:
      'Только публичный интерфейс platform: импортируйте "@/platform" или "@/platform/<область>".',
  },
]

/** Домены не знают про доставку: delivery читает их, а не наоборот. */
const noDeliveryFromDomain = {
  group: ['@/modules/delivery', '@/modules/delivery/**'],
  message:
    'Доменный модуль не импортирует delivery. Домен не знает, что его данные кто-то отдаёт наружу — иначе delivery невозможно выделить в отдельный сервис.',
}

/** platform — основание: он не может зависеть от модулей, которые на нём стоят. */
const noModulesFromPlatform = {
  group: ['@/modules', '@/modules/**'],
  message:
    'platform — общее основание и не знает о модулях. Зависимость направлена только вниз: modules → platform.',
}

/** process.env читается ровно в одном месте (ТЗ разд. 6, TASK-005). */
const noProcessEnv = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'process.env читается только в src/platform/config/env.ts. Везде остальном — импорт готового объекта конфигурации. ТЗ разд. 6.',
}

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', '.next/**', 'docs/**', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.mts', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: publicInterfaceOnly }],
      'no-restricted-syntax': ['error', noProcessEnv],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },

  // Доменные модули: плюс запрет на delivery.
  {
    files: [
      'src/modules/stream/**/*.ts',
      'src/modules/design/**/*.ts',
      'src/modules/trading/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...publicInterfaceOnly, noDeliveryFromDomain] },
      ],
    },
  },

  // platform: плюс запрет на любые модули.
  {
    files: ['src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...publicInterfaceOnly, noModulesFromPlatform] },
      ],
    },
  },

  // Единственное место, где разрешён process.env.
  {
    files: ['src/platform/config/env.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  /**
   * Служебные скрипты на чистом JS.
   *
   * Для файлов TypeScript правило `no-undef` отключено конфигурацией
   * typescript-eslint — там за существование имён отвечает компилятор.
   * В `.mjs` компилятора нет, поэтому глобальные объекты Node объявляются явно:
   * это заодно и документация того, на что скрипты опираются.
   */
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      // Служебному скрипту нечем сообщать о результате, кроме вывода.
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Тесты: process.env не читают, но console нужен редко — оставляем запрет,
  // зато разрешаем импорт внутренностей своего же модуля через относительные пути (они и так не под запретом).
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)

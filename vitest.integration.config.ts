import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Интеграционные тесты — отдельная конфигурация.
 *
 * Им нужна живая база, поэтому они не должны попадать в быстрый прогон
 * `pnpm run test`: обычные тесты обязаны выполняться без окружения и за
 * секунду, иначе их перестают запускать.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    /**
     * Строго последовательно: тесты работают с общей базой, и параллельный
     * прогон дал бы гонки, которые выглядят как случайные падения.
     */
    fileParallelism: false,
    pool: 'forks',
  },
})

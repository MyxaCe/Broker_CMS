import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Конфигурация читается из окружения процесса; тесты обязаны быть
    // изолированы друг от друга, иначе утечка переменных даст ложно-зелёный прогон.
    clearMocks: true,
    restoreMocks: true,
  },
})

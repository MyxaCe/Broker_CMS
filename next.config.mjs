import { withPayload } from '@payloadcms/next/withPayload'

/**
 * Заголовки безопасности (ТЗ разд. 6).
 *
 * Задаются в приложении, а не только на обратном прокси: прокси ещё не
 * существует, а защита, которая живёт исключительно в инфраструктуре,
 * отсутствует на машине разработчика и в тестах. Прокси станет вторым
 * рубежом, а не первым.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    /**
     * HSTS отправляется всегда: браузер применяет его только к HTTPS-ответам,
     * поэтому на локальном HTTP заголовок безвреден, а на проде не зависит от
     * того, вспомнил ли кто-то настроить его на прокси.
     */
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Версия и внутренности фреймворка наружу не сообщаются.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })

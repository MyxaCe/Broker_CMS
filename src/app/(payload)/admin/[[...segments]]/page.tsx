import config from '@payload-config'
import { generatePageMetadata, RootPage } from '@payloadcms/next/views'

import { importMap } from '../importMap.js'

import type { Metadata } from 'next'

type Args = {
  readonly params: Promise<{ segments: string[] }>
  readonly searchParams: Promise<Record<string, string | string[]>>
}

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

export default function AdminPage({ params, searchParams }: Args) {
  return RootPage({ config, importMap, params, searchParams })
}

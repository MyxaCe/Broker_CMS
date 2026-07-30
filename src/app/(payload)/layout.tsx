import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'

import { importMap } from './admin/importMap.js'

import type { ServerFunctionClient } from 'payload'
import type { ReactNode } from 'react'

import '@payloadcms/next/css'

/**
 * Оболочка админки Payload.
 *
 * Группа маршрутов `(payload)` отделена намеренно: всё, что внутри неё, —
 * интерфейс редактора и его служебный HTTP-слой, а не публичная выдача.
 * Единственная дверь для потребителей — `/v1` (ADR-0009).
 */
const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}

export default function PayloadLayout({ children }: { readonly children: ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}

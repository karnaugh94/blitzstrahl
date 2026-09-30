/**
 * Completion from blitzstrahl's JSON Schemas (syntax.md §3.4): each kind's
 * top-level keys, their descriptions, and the values a key takes when the
 * schema lists them. Pure: no VS Code.
 */
import type { YamlKind } from './yaml-context.js'

interface JsonSchema {
  description?: string
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
}

export interface KeyInfo {
  name: string
  description?: string
  /** Values to offer, as they'd be written in YAML. */
  values: string[]
}

export type Schemas = Partial<Record<YamlKind, JsonSchema>>

/** The keys a kind of block takes, in the schema's order. */
export function keysOf(schemas: Schemas, kind: YamlKind): KeyInfo[] {
  const schema = schemas[kind]
  if (!schema) return []
  // An embed's body is a URL or a mapping: the mapping's keys.
  const props = schema.properties ?? schema.anyOf?.find((s) => s.properties)?.properties ?? {}
  return Object.entries(props).map(([name, s]) => ({ name, ...(s.description ? { description: s.description } : {}), values: valuesOf(s) }))
}

export function keyInfo(schemas: Schemas, kind: YamlKind, key: string): KeyInfo | undefined {
  return keysOf(schemas, kind).find((k) => k.name === key)
}

function valuesOf(s: JsonSchema): string[] {
  const out: unknown[] = []
  const walk = (x: JsonSchema) => {
    if (x.enum) out.push(...x.enum)
    if ('const' in x) out.push(x.const)
    const types = typeof x.type === 'string' ? [x.type] : (x.type ?? [])
    // Only when it's all the key takes: a boolean among strings is free text's business.
    if (types.length === 1 && types[0] === 'boolean') out.push(true, false)
    x.anyOf?.forEach(walk)
  }
  walk(s)
  return [...new Set(out.map(yamlValue))]
}

/** A value as YAML writes it: quoted when plain YAML would read it as something else. */
export function yamlValue(v: unknown): string {
  if (typeof v !== 'string') return String(v)
  const plain = /^([A-Za-z_]|\.{0,2}\/)[\w./-]*$/.test(v) && !/^(true|false|yes|no|on|off|null|~)$/i.test(v)
  return plain ? v : JSON.stringify(v)
}

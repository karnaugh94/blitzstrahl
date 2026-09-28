/**
 * The one description of what each kind of YAML in a deck may hold (PLAN
 * §15, M8.4): deck and slide frontmatter here, render block bodies next to
 * their renderers. Validators take their keys and per-key rules from these
 * tables, and `blitzstrahl/schema/*.json` is generated from them, so the
 * two can't drift apart. A test samples both to make sure they agree.
 *
 * Pure: browser code reaches it through `@blitzstrahl/core/schema`.
 */
import { THOUSANDS } from './numbers.js'
import { LAYOUTS, TRANSITIONS, type SlideKey } from './vocab.js'

/** The part of JSON Schema (2020-12) the tables use. */
export interface Schema {
  type?: SchemaType | readonly SchemaType[]
  enum?: readonly unknown[]
  const?: unknown
  pattern?: string
  minLength?: number
  minimum?: number
  maximum?: number
  /** Every item (arrays). */
  items?: Schema
  /** The first items, one schema each (a tuple). */
  prefixItems?: readonly Schema[]
  minItems?: number
  maxItems?: number
  anyOf?: readonly Schema[]
  allOf?: readonly Schema[]
  not?: Schema
  if?: Schema
  then?: Schema
  /** Objects: the schema of each named key, and which keys must be there. */
  properties?: Readonly<Record<string, Schema>>
  required?: readonly string[]
  /** Objects: what every key's name must match. */
  propertyNames?: Schema
  /** Objects: a key that needs others beside it. */
  dependentRequired?: Readonly<Record<string, readonly string[]>>
  description?: string
}
type SchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

/** One key of a mapping: what it may hold, and what the author is told when it doesn't. */
export interface KeyRule {
  schema: Schema
  /** The error when the value doesn't match `schema`, without the key: "must be true or false". */
  message: string
}

export type KeyTable = Readonly<Record<string, KeyRule>>

const typeOf = (v: unknown): SchemaType =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : (typeof v as SchemaType)

/** Whether `value` matches `schema`, as a JSON Schema validator would say. */
export function matches(schema: Schema, value: unknown): boolean {
  if (schema.type !== undefined) {
    const types = typeof schema.type === 'string' ? [schema.type] : schema.type
    const t = typeOf(value)
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return false
  }
  if (schema.enum && !schema.enum.includes(value)) return false
  if ('const' in schema && schema.const !== value) return false
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return false
    if (schema.minLength !== undefined && [...value].length < schema.minLength) return false
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false
    if (schema.maximum !== undefined && value > schema.maximum) return false
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
    const tuple = schema.prefixItems ?? []
    if (!tuple.every((s, i) => i >= value.length || matches(s, value[i]))) return false
    if (schema.items && !value.slice(tuple.length).every((v) => matches(schema.items!, v))) return false
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (schema.required && !schema.required.every((k) => Object.hasOwn(o, k))) return false
    if (schema.propertyNames && !Object.keys(o).every((k) => matches(schema.propertyNames!, k))) return false
    if (schema.properties && !Object.entries(schema.properties).every(([k, s]) => !Object.hasOwn(o, k) || matches(s, o[k]))) return false
    if (schema.dependentRequired && !Object.entries(schema.dependentRequired).every(([k, need]) => !Object.hasOwn(o, k) || need.every((n) => Object.hasOwn(o, n)))) return false
  }
  if (schema.anyOf && !schema.anyOf.some((s) => matches(s, value))) return false
  if (schema.allOf && !schema.allOf.every((s) => matches(s, value))) return false
  if (schema.not && matches(schema.not, value)) return false
  if (schema.if && matches(schema.if, value) && schema.then && !matches(schema.then, value)) return false
  return true
}

/** The first problem with `value` under `key`, as the author reads it; undefined if none. */
export function keyProblem(table: KeyTable, key: string, value: unknown): string | undefined {
  const rule = table[key]
  return rule && !matches(rule.schema, value) ? `\`${key}\` ${rule.message}` : undefined
}

/** Text written plainly in YAML: `2026`, `true` and dates are read as text too. */
const SCALAR: Schema = { type: ['string', 'number', 'boolean'] }
const THOUSANDS_RULE: KeyRule = { schema: { enum: THOUSANDS }, message: 'must be ",", "." or " " (quoted), the mark that groups thousands in the deck\'s data' }
export const MS: KeyRule = {
  schema: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'string', pattern: '^\\s*\\d+(\\.\\d+)?(ms)?$' }] },
  message: 'must be a duration in milliseconds',
}
const TRANSITION: KeyRule = { schema: { enum: [...TRANSITIONS] }, message: `must be a transition: ${[...TRANSITIONS].join(', ')}` }

/** Deck frontmatter (syntax.md §3.1). */
export const DECK_SCHEMA: KeyTable = {
  title: { schema: SCALAR, message: 'should be a string' },
  author: { schema: SCALAR, message: 'should be a string' },
  date: { schema: SCALAR, message: 'should be a string' },
  lang: { schema: SCALAR, message: 'should be a string' },
  thousands: THOUSANDS_RULE,
  theme: { schema: SCALAR, message: 'should be a string' },
  canvas: { schema: { type: 'string', pattern: '^0*[1-9]\\d*\\s*x\\s*0*[1-9]\\d*$' }, message: 'must look like `1280x720`' },
  transition: TRANSITION,
  'transition-dur': MS,
  // A folder inside the deck's, whose first name isn't one `dev` serves itself (syntax.md §3.5).
  public: {
    schema: { type: 'string', pattern: '^(\\./)?(?!_blitz(/|$))[^/.@][^/]*(/[^/.][^/]*)*/?$' },
    message: "must be a ./folder inside the deck's folder, not the folder itself, with no part of its path starting with `.`, and not named `_blitz` or starting with `@`",
  },
  // One background for every slide, or one per layout (syntax.md §3.6).
  background: {
    schema: { anyOf: [SCALAR, { type: 'object', propertyNames: { enum: Object.keys(LAYOUTS) }, properties: Object.fromEntries(Object.keys(LAYOUTS).map((l) => [l, SCALAR])) }] },
    message: 'should be a string (an image, or a CSS background), or layout names each with one',
  },
  plugins: {
    schema: { anyOf: [{ type: 'string', pattern: '\\S' }, { type: 'array', items: { type: 'string', pattern: '\\S' } }] },
    message: 'must be a list of module names or paths',
  },
}

/** Slide frontmatter (syntax.md §3.2). */
export const SLIDE_SCHEMA: Readonly<Record<SlideKey, KeyRule>> = {
  id: { schema: SCALAR, message: 'should be a string' },
  layout: { schema: { enum: Object.keys(LAYOUTS) }, message: `must be a layout: ${Object.keys(LAYOUTS).join(', ')}` },
  transition: TRANSITION,
  'transition-dur': MS,
  background: { schema: SCALAR, message: 'should be a string: an image, or a CSS background' },
  class: { schema: SCALAR, message: 'should be a string of class names' },
  style: { schema: SCALAR, message: 'should be a string of CSS' },
}

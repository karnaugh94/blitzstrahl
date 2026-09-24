/**
 * Built-in renderers. Import each one lazily by its subpath
 * (`@blitzstrahl/renderers/chart`) so it lands in its own chunk; this index
 * only names them.
 */
export const BUILTIN_RENDERERS = ['chart', 'table'] as const

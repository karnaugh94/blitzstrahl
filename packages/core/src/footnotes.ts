/**
 * Footnotes defined anywhere in the deck (syntax.md §14). The deck is parsed
 * as one document, so a citation is recognised wherever its definition is;
 * but each slide becomes HTML on its own, and a definition on another slide
 * never reached it. Each slide gets a copy of every definition it cites and
 * doesn't hold. A definition only shows where it's cited (mdast-util-to-hast
 * lists cited ones only), so the one on its own slide stays hidden there.
 *
 * Runs on the raw slides, before attribute blocks are attached, so copies
 * are attached like anything else on their new slide. Presenter notes are
 * left alone: a definition in `::: notes` is a note.
 */
import type { FootnoteDefinition, Nodes, RootContent } from 'mdast'
import { spanOf, type Diagnostics } from './diagnostics.js'

type Slide = { nodes: RootContent[] }

const isNotes = (n: Nodes) => n.type === 'blitzContainer' && (n as { name?: string }).name === 'notes'

/** Visit every node outside notes; `visit` may return false to drop a node from its parent. */
function each(nodes: Nodes[], visit: (n: Nodes) => boolean | void) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    if (isNotes(n)) continue
    if (visit(n) === false) {
      nodes.splice(i--, 1)
      continue
    }
    if ('children' in n) each(n.children as Nodes[], visit)
  }
}

export function shareFootnotes(slides: Slide[], diags: Diagnostics): void {
  // The first definition of each label wins, as in GFM.
  const defs = new Map<string, FootnoteDefinition>()
  for (const s of slides) {
    each(s.nodes, (n) => {
      if (n.type !== 'footnoteDefinition') return
      if (defs.has(n.identifier)) {
        diags.warn('footnote/twice', `footnote \`[^${n.label ?? n.identifier}]\` is already defined; the first definition is used`, spanOf(n.position))
        return false
      }
      defs.set(n.identifier, n)
    })
  }

  const cited = new Set<string>()
  for (const s of slides) {
    const own = new Set<string>()
    const cites: string[] = []
    each(s.nodes, (n) => {
      if (n.type === 'footnoteDefinition') own.add(n.identifier)
      else if (n.type === 'footnoteReference') cites.push(n.identifier)
      else if (n.type === 'text') {
        // GFM leaves a citation of an undefined label as text.
        for (const m of n.value.matchAll(/\[\^([^\]\s]+)\]/g)) {
          diags.warn('footnote/undefined', `footnote \`[^${m[1]}]\` isn't defined anywhere in the deck; it's shown as text`, spanOf(n.position))
        }
      }
    })
    for (const id of cites) {
      cited.add(id)
      const def = defs.get(id)
      if (!def || own.has(id)) continue
      own.add(id)
      s.nodes.push(JSON.parse(JSON.stringify(def)) as FootnoteDefinition)
    }
  }

  for (const [id, def] of defs) {
    if (!cited.has(id)) diags.warn('footnote/unused', `footnote \`[^${def.label ?? id}]\` isn't cited on any slide`, spanOf(def.position))
  }
}

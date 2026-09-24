import type { Root } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified, type Processor } from 'unified'
import { blitzFromMarkdown } from './mdast.js'
import { blitzSyntax } from './micromark.js'

export type { BlitzAttrs, BlitzContainer, BlitzSpan } from './mdast.js'

function remarkBlitz(this: Processor) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(blitzSyntax())
  ;(data.fromMarkdownExtensions ??= []).push(blitzFromMarkdown())
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkBlitz)

/** Markdown → mdast with blitzstrahl's syntax extensions. No transforms. */
export function parseMarkdown(source: string): Root {
  return processor.parse(source)
}

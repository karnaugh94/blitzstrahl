#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { build } from './build.js'
import { dev } from './dev.js'

const HELP = `blitzstrahl — Markdown in. A deck worth watching out.

Usage:
  blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]
  blitzstrahl build <deck.md> [--out dist] [--force] [--strict]

Commands:
  dev     Live preview with reload on save (keeps your slide and step)
  build   Static site in dist/ (serve it over HTTP)

Options:
  --out, -o   Output directory for build (default: dist/ next to the deck)
  --force     Build even if the deck has errors
  --strict    Fail if any slide overflows the canvas (or it can't be checked)
  --port, -p  Dev server port
  --host      Listen on all addresses (present from another device)
  --open      Open the browser
  --help, -h  Show this help
`

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      force: { type: 'boolean' },
      strict: { type: 'boolean' },
      port: { type: 'string', short: 'p' },
      host: { type: 'boolean' },
      open: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, deck] = positionals
  if (values.help || !command) {
    process.stdout.write(HELP)
    return values.help ? 0 : 1
  }
  if (!deck) {
    process.stderr.write(`blitzstrahl ${command}: which deck? e.g. \`blitzstrahl ${command} talk.md\`\n`)
    return 1
  }

  switch (command) {
    case 'build': {
      const opts: Parameters<typeof build>[1] = {}
      if (values.out) opts.outDir = values.out
      if (values.force) opts.force = true
      if (values.strict) opts.strict = true
      const r = await build(deck, opts)
      if (!r.ok && !r.index) {
        process.stderr.write('blitzstrahl: build stopped because the deck has errors (use --force to build anyway)\n')
        return 1
      }
      if (!r.ok) {
        const n = new Set(r.overflow.map((d) => d.span.start.line)).size
        process.stderr.write(
          r.overflowSkipped
            ? 'blitzstrahl: --strict needs the overflow check, which could not run\n'
            : `blitzstrahl: --strict: ${n} slide${n === 1 ? '' : 's'} overflow${n === 1 ? 's' : ''} (written to ${r.outDir} anyway)\n`,
        )
        return 1
      }
      process.stdout.write(`built ${r.index}\n`)
      return 0
    }
    case 'dev': {
      const opts: Parameters<typeof dev>[1] = {}
      if (values.port) opts.port = Number(values.port)
      if (values.host) opts.host = true
      if (values.open) opts.open = true
      const server = await dev(deck, opts)
      server.printUrls()
      return new Promise<number>(() => {}) // run until interrupted
    }
    default:
      process.stderr.write(`blitzstrahl: unknown command \`${command}\`\n\n${HELP}`)
      return 1
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`blitzstrahl: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exit(1)
  },
)


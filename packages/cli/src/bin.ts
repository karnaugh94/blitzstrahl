#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from './build.js'
import { dev } from './dev.js'
import { check } from './check.js'
import { CliError } from './errors.js'
import { exportPdf } from './export.js'
import { hasErrors, printDiagnostics, summary } from './report.js'

const HELP = `blitzstrahl — Markdown in. A deck worth watching out.

Usage:
  blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]
  blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict]
  blitzstrahl export <deck.md> [--out deck.pdf] [--steps] [--force]
  blitzstrahl check <deck.md> [--offline] [--strict]

Commands:
  dev     Live preview with reload on save (keeps your slide and step)
  build   Static site in dist/ (serve it over HTTP), or with --standalone,
          one .html file that opens straight from disk
  export  PDF: one page per slide at its final step (--steps: every step)
  check   Find problems before the talk: errors, missing files, broken
          charts and maps, step gaps, overflow, embeds that refuse framing

Options:
  --out, -o      build: output folder (default: dist/ next to the deck);
                 with --standalone, the file (default: <deck>.html next to it)
                 export: the PDF (default: <deck>.pdf next to the deck)
  --standalone   build: everything in one self-contained .html file
  --steps        export: a page for every build step (handouts)
  --force        Build even if the deck has errors
  --strict       build: fail if any slide overflows the canvas (or it can't be
                 checked); check: fail on warnings, not just errors
  --offline      check: don't contact embedded sites
  --port, -p     dev: server port
  --host         dev: listen on all addresses (present from another device)
  --open         dev: open the browser
  --help, -h     Show this help, or a command's (blitzstrahl build --help)
  --version, -v  Show the version

Exit codes: 0 fine, 1 the deck has problems, 2 the command line is wrong.

Environment:
  BLITZSTRAHL_SKIP_OVERFLOW_CHECK=1   build: skip the overflow check (needs no
                                      browser); --strict still checks
`

/** Each command's usage, and the options it takes. */
const COMMANDS: Record<string, { usage: string; options: string[]; help: string }> = {
  dev: {
    usage: 'blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]',
    options: ['port', 'host', 'open'],
    help: `A live preview. Saving the deck, a file it uses, or a local theme or plugin
updates the open deck.

  --port, -p     server port (default 5173, or the next free one)
  --host         listen on all addresses, to show the deck on another device;
                 only the deck and the files it uses are served
  --open         open the browser`,
  },
  build: {
    usage: 'blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict]',
    options: ['out', 'standalone', 'force', 'strict'],
    help: `A static site in dist/ next to the deck (serve it over HTTP), or with
--standalone one .html file that opens straight from disk.

  --out, -o      the folder (default dist/ next to the deck); with --standalone,
                 the .html file (default <deck>.html next to the deck)
  --standalone   everything in one self-contained .html file
  --force        build even if the deck has errors
  --strict       fail if a slide overflows the canvas, or if that can't be checked`,
  },
  export: {
    usage: 'blitzstrahl export <deck.md> [--out deck.pdf] [--steps] [--force]',
    options: ['out', 'steps', 'force'],
    help: `A PDF, one page per slide at its final step.

  --out, -o      the .pdf (default <deck>.pdf next to the deck)
  --steps        a page for every build step (handouts)
  --force        export even if the deck has errors`,
  },
  check: {
    usage: 'blitzstrahl check <deck.md> [--offline] [--strict]',
    options: ['offline', 'strict'],
    help: `Find problems before the talk: errors, missing files, broken charts and
maps, step gaps, overflow, embeds that refuse to be framed.

  --offline      don't contact embedded sites or map data URLs
  --strict       exit 1 on warnings, not just errors`,
  },
}

const OPTIONS = {
  out: { type: 'string', short: 'o' },
  force: { type: 'boolean' },
  strict: { type: 'boolean' },
  standalone: { type: 'boolean' },
  steps: { type: 'boolean' },
  offline: { type: 'boolean' },
  port: { type: 'string', short: 'p' },
  host: { type: 'boolean' },
  open: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

/** The closest name to `word`, if one is close enough to be a typo of it. */
function closest(word: string, names: readonly string[]): string | undefined {
  const d = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const t = row[j]!
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
        prev = t
      }
    }
    return row[b.length]!
  }
  const best = names.map((n) => [n, d(word, n)] as const).sort((a, b) => a[1] - b[1])[0]
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : undefined
}

function parse(argv: string[]) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  } catch (err) {
    const message = (err as Error).message
    const unknown = /Unknown option '(-{1,2})([^']+)'/.exec(message)
    if (unknown) {
      const near = closest(unknown[2]!, Object.keys(OPTIONS))
      throw new CliError(`unknown option \`${unknown[1]}${unknown[2]}\`${near ? `: did you mean \`--${near}\`?` : ''} (see \`blitzstrahl --help\`)`)
    }
    const missing = /Option '(?:-\w, )?(--[\w-]+)[^']*' argument missing/.exec(message)
    if (missing) throw new CliError(`\`${missing[1]}\` needs a value`)
    throw new CliError(message.split('\n')[0]!)
  }
}

/** The deck file, or a CliError that says what's wrong with it. */
function deckFile(deck: string): string {
  const file = resolve(deck)
  if (!existsSync(file)) {
    const dir = dirname(file)
    const near = existsSync(dir) ? closest(basename(file), readdirSync(dir).filter((f) => /\.(md|markdown)$/i.test(f))) : undefined
    throw new CliError(`can't find ${deck}${near ? `: did you mean ${join(dirname(deck), near)}?` : ''}`)
  }
  if (statSync(file).isDirectory()) {
    const decks = readdirSync(file).filter((f) => /\.(md|markdown)$/i.test(f))
    throw new CliError(`${deck} is a folder: name the deck's .md file${decks.length === 1 ? `, e.g. ${join(deck, decks[0]!)}` : ''}`)
  }
  return deck
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv)
  const [command, deck] = positionals
  if (values.version) {
    process.stdout.write(`blitzstrahl ${VERSION}\n`)
    return 0
  }
  if (command !== undefined && !Object.hasOwn(COMMANDS, command)) {
    const near = closest(command, Object.keys(COMMANDS))
    throw new CliError(`unknown command \`${command}\`${near ? `: did you mean \`${near}\`?` : ''} (see \`blitzstrahl --help\`)`)
  }
  if (values.help || !command) {
    const c = command && COMMANDS[command]
    process.stdout.write(c ? `Usage: ${c.usage}\n\n${c.help}\n` : HELP)
    return values.help ? 0 : 2
  }
  const spec = COMMANDS[command]!
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || name === 'help') continue
    if (!spec.options.includes(name)) {
      const owner = Object.entries(COMMANDS).find(([, c]) => c.options.includes(name))?.[0]
      throw new CliError(`\`--${name}\` is an option of \`${owner}\`, not \`${command}\` (see \`blitzstrahl ${command} --help\`)`)
    }
  }
  if (!deck) throw new CliError(`which deck? e.g. \`blitzstrahl ${command} talk.md\``)
  if (positionals.length > 2) throw new CliError(`one deck at a time: \`blitzstrahl ${command} ${deck}\``)
  deckFile(deck)
  if (values.port !== undefined && !(/^\d+$/.test(values.port) && Number(values.port) <= 65535)) {
    throw new CliError(`\`--port\` must be a number from 0 to 65535, not \`${values.port}\``)
  }

  switch (command) {
    case 'build': {
      const opts: Parameters<typeof build>[1] = {}
      if (values.standalone) opts.standalone = true
      if (values.out) {
        if (values.standalone) opts.outFile = values.out
        else opts.outDir = values.out
      }
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
    case 'export': {
      const opts: Parameters<typeof exportPdf>[1] = {}
      if (values.out) opts.outFile = values.out
      if (values.steps) opts.steps = true
      if (values.force) opts.force = true
      const r = await exportPdf(deck, opts)
      for (const w of r.warnings) process.stderr.write(`blitzstrahl: ${w}\n`)
      if (!r.ok) {
        process.stderr.write(`blitzstrahl: ${r.error}\n`)
        return 1
      }
      process.stdout.write(`exported ${r.file} (${r.pages} page${r.pages === 1 ? '' : 's'})\n`)
      return 0
    }
    case 'check': {
      const r = await check(deck, values.offline ? { offline: true } : {})
      printDiagnostics(r.diagnostics)
      for (const s of r.skipped) process.stderr.write(`blitzstrahl: not checked: ${s}\n`)
      const failed = hasErrors(r.diagnostics) || (!!values.strict && r.diagnostics.some((d) => d.severity === 'warning'))
      process.stdout.write(`${deck}: ${r.diagnostics.length ? summary(r.diagnostics) : 'no problems found'}\n`)
      return failed ? 1 : 0
    }
    case 'dev': {
      const opts: Parameters<typeof dev>[1] = {}
      if (values.port) opts.port = Number(values.port)
      if (values.host) opts.host = true
      if (values.open) opts.open = true
      const server = await dev(deck, opts)
      server.printUrls()
      if (opts.host) process.stdout.write('  Anyone on this network can open the deck and the files it uses; nothing else in its folder is served.\n')
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
    if (err instanceof CliError) {
      process.stderr.write(`blitzstrahl: ${err.message}\n`)
      process.exit(err.exitCode)
    }
    process.stderr.write(`blitzstrahl: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exit(1)
  },
)


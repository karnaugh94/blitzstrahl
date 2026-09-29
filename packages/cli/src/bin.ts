#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from './build.js'
import { dev } from './dev.js'
import { check } from './check.js'
import { CliError } from './errors.js'
import { exportPdf } from './export.js'
import { present } from './present.js'
import { importTheme } from './import.js'
import { newDeck } from './new.js'
import { VERSION } from './version.js'
import { FORMATS, formatReport, hasErrors, printDiagnostics, summary, type Format } from './report.js'

const HELP = `blitzstrahl — Markdown in. A deck worth watching out.

Usage:
  blitzstrahl new [talk.md] [--theme aurora]
  blitzstrahl dev <deck.md> [--port 5173] [--host] [--open]
  blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict] [--format text]
  blitzstrahl export <deck.md> [--out deck.pdf] [--steps | --notes] [--force]
  blitzstrahl present <deck.md> [--port 5180] [--no-open] [--force]
  blitzstrahl check <deck.md> [--offline] [--strict] [--format text]
  blitzstrahl theme import <template.potx> [--out folder]

Commands:
  new     Start a deck: a short tour to edit, with a chart and its data
  dev     Live preview with reload on save (keeps your slide and step)
  build   Static site in dist/ (serve it over HTTP), or with --standalone,
          one .html file that opens straight from disk
  export  PDF: one page per slide at its final step (--steps: every step;
          --notes: a handout with the presenter notes)
  present Give the talk with a phone as the remote: serves the deck, prints a
          QR code for the phone
  check   Find problems before the talk: errors, missing files, broken
          charts and maps, step gaps, overflow, embeds that refuse framing
  theme   theme import: a CSS theme from a PowerPoint template (.potx, .pptx)

Options:
  --out, -o      build: output folder (default: dist/ next to the deck);
                 with --standalone, the file (default: <deck>.html next to it)
                 export: the PDF (default: <deck>.pdf next to the deck)
                 theme import: the folder (default: next to the template)
  --standalone   build: everything in one self-contained .html file
  --steps        export: a page for every build step
  --notes        export: a handout, each slide with its notes (A4)
  --force        Build even if the deck has errors
  --strict       build: fail if any slide overflows the canvas (or it can't be
                 checked); check: fail on warnings, not just errors
  --offline      check: don't contact embedded sites
  --format       check, build: text (default), json, or github (annotations)
  --theme        new: the deck's theme (default aurora)
  --port, -p     dev, present: server port
  --no-open      present: print the deck's address instead of opening it
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
  new: {
    usage: 'blitzstrahl new [talk.md] [--theme aurora]',
    options: ['theme'],
    help: `Start a deck: talk.md (or the file you name) and the data file its chart
reads, <name>-data.csv. Never replaces a file: if either is there, it writes
neither.

  --theme        the deck's theme: aurora (default), broadsheet, a package
                 or a ./path`,
  },
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
    usage: 'blitzstrahl build <deck.md> [--out dist] [--standalone] [--force] [--strict] [--format text]',
    options: ['out', 'standalone', 'force', 'strict', 'format'],
    help: `A static site in dist/ next to the deck (serve it over HTTP), or with
--standalone one .html file that opens straight from disk.

  --out, -o      the folder (default dist/ next to the deck); with --standalone,
                 the .html file (default <deck>.html next to the deck)
  --standalone   everything in one self-contained .html file
  --force        build even if the deck has errors
  --strict       fail if a slide overflows the canvas, or if that can't be checked
  --format       how to write diagnostics: text (default), json (one document
                 on stdout), github (GitHub Actions annotations)`,
  },
  export: {
    usage: 'blitzstrahl export <deck.md> [--out deck.pdf] [--steps | --notes] [--force]',
    options: ['out', 'steps', 'notes', 'force'],
    help: `A PDF, one page per slide at its final step.

  --out, -o      the .pdf (default <deck>.pdf next to the deck)
  --steps        a page for every build step
  --notes        a handout: A4 pages, each slide with its presenter notes
  --force        export even if the deck has errors`,
  },
  present: {
    usage: 'blitzstrahl present <deck.md> [--port 5180] [--no-open] [--force]',
    options: ['port', 'no-open', 'force'],
    help: `Give the talk with a phone as the remote. Builds the deck, serves it,
opens it in your browser, and prints a QR code: scan it with the phone. The
code works once. Only this machine can open the deck; the network gets the
remote alone. Ctrl+C stops it.

  --port, -p     server port (default 5180, or the next free one)
  --no-open      print the deck's address instead of opening it
  --force        serve the deck even if it has errors`,
  },
  check: {
    usage: 'blitzstrahl check <deck.md> [--offline] [--strict] [--format text]',
    options: ['offline', 'strict', 'format'],
    help: `Find problems before the talk: errors, missing files, broken charts and
maps, step gaps, overflow, embeds that refuse to be framed.

  --offline      don't contact embedded sites or map data URLs
  --strict       exit 1 on warnings, not just errors
  --format       text (default), json (one document on stdout), github
                 (GitHub Actions annotations)`,
  },
  theme: {
    usage: 'blitzstrahl theme import <template.potx> [--out folder]',
    options: ['out'],
    help: `A CSS theme from a PowerPoint template (.potx, or a .pptx: its masters and
layouts are read, its slides ignored): brand.css with the template's colours,
fonts, backgrounds by layout and logo, the pictures in img/, and sample.md, a
deck to look at it with. What it couldn't carry over is listed.

  --out, -o      the folder to write (default: next to the template, named
                 after it); it must be new or empty`,
  },
}

const OPTIONS = {
  out: { type: 'string', short: 'o' },
  force: { type: 'boolean' },
  strict: { type: 'boolean' },
  standalone: { type: 'boolean' },
  steps: { type: 'boolean' },
  notes: { type: 'boolean' },
  offline: { type: 'boolean' },
  theme: { type: 'string' },
  format: { type: 'string' },
  port: { type: 'string', short: 'p' },
  host: { type: 'boolean' },
  open: { type: 'boolean' },
  'no-open': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const


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
  const show = (f: string) => relative(process.cwd(), f) || f
  if (positionals.length > 2 && command !== 'theme') throw new CliError(`one deck at a time: \`blitzstrahl ${command} ${deck}\``)
  if (command === 'new') {
    const r = await newDeck(deck, values.theme !== undefined ? { theme: values.theme } : {})
    process.stdout.write(`wrote ${show(r.deck)} and ${show(r.data)}\n\nPreview it (saving updates the page):\n  npx blitzstrahl dev ${show(r.deck)}\n`)
    return 0
  }
  if (command === 'theme') return themeCommand(positionals.slice(1), values.out)
  if (!deck) throw new CliError(`which deck? e.g. \`blitzstrahl ${command} talk.md\``)
  deckFile(deck)
  if (values.port !== undefined && !(/^\d+$/.test(values.port) && Number(values.port) <= 65535)) {
    throw new CliError(`\`--port\` must be a number from 0 to 65535, not \`${values.port}\``)
  }

  const format = (values.format ?? 'text') as Format
  if (!FORMATS.includes(format)) throw new CliError(`\`--format\` must be ${FORMATS.join(', ')}, not \`${values.format}\``)
  const machine = format === 'text' ? undefined : format
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
      if (machine) Object.assign(opts, { report: false, quiet: true })
      const r = await build(deck, opts)
      if (machine) {
        const diagnostics = [...r.diagnostics, ...r.overflow].sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column)
        const skipped = r.overflowSkipped ? [`overflow: ${r.overflowSkipped}`] : []
        process.stdout.write(formatReport(machine, { deck, diagnostics, skipped, output: r.index ? show(r.index) : null }))
      }
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
      if (!machine) process.stdout.write(`built ${r.index}\n`)
      return 0
    }
    case 'export': {
      const opts: Parameters<typeof exportPdf>[1] = {}
      if (values.out) opts.outFile = values.out
      if (values.steps && values.notes) throw new CliError('--steps and --notes don\'t go together: a handout shows each slide at its final step')
      if (values.steps) opts.steps = true
      if (values.notes) opts.notes = true
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
      const failed = hasErrors(r.diagnostics) || (!!values.strict && r.diagnostics.some((d) => d.severity === 'warning'))
      if (machine) {
        process.stdout.write(formatReport(machine, { deck, diagnostics: r.diagnostics, skipped: r.skipped }))
        return failed ? 1 : 0
      }
      printDiagnostics(r.diagnostics)
      for (const s of r.skipped) process.stderr.write(`blitzstrahl: not checked: ${s}\n`)
      process.stdout.write(`${deck}: ${r.diagnostics.length ? summary(r.diagnostics) : 'no problems found'}\n`)
      return failed ? 1 : 0
    }
    case 'present': {
      const opts: Parameters<typeof present>[1] = {}
      if (values.port) opts.port = Number(values.port)
      if (values['no-open']) opts.open = false
      if (values.force) opts.force = true
      const r = await present(deck, opts)
      if (!r.ok) {
        printDiagnostics(r.diagnostics)
        process.stderr.write('blitzstrahl: the deck has errors, so it isn\'t served (use --force to serve it anyway)\n')
        return 1
      }
      printDiagnostics(r.diagnostics)
      const code = r.pair()
      const lines = [
        `Deck:    ${r.url}${values['no-open'] ? '' : '  (opened in your browser)'}`,
        '',
        code.text,
        `Remote:  scan the code with your phone, or open ${code.url}`,
        '         The code works once. For another phone, use Remote in the presenter view (P).',
      ]
      if (!r.addresses.length) lines.push('         This machine has no network address: the phone can\'t reach it. Join a network (your phone\'s hotspot works).')
      else if (r.addresses.length > 1) lines.push(`         Not reachable? This machine is also at ${r.addresses.slice(1).join(', ')}.`)
      lines.push('', 'Ctrl+C stops.')
      process.stdout.write(`${lines.join('\n')}\n`)
      const stop = () => void r.close().then(() => process.exit(0))
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      return new Promise<number>(() => {}) // run until interrupted
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

/** `theme import <template>`: the theme's files, then what didn't carry over. */
async function themeCommand([sub, template, ...rest]: string[], out: string | undefined): Promise<number> {
  if (sub !== 'import') throw new CliError(`\`blitzstrahl theme\` has one subcommand: \`blitzstrahl theme import template.potx\``)
  if (!template) throw new CliError('which template? e.g. `blitzstrahl theme import brand.potx`')
  if (rest.length) throw new CliError(`one template at a time: \`blitzstrahl theme import ${template}\``)
  const r = await importTheme(template, out !== undefined ? { out } : {})
  const show = (f: string) => relative(process.cwd(), f) || f
  const lines = [
    `wrote ${show(join(r.outDir, 'brand.css'))}, ${show(join(r.outDir, 'sample.md'))} and the pictures in ${show(join(r.outDir, 'img'))}`,
    `  colours: ${['bg', 'fg', 'accent', 'accent-2'].map((t) => `${t} ${r.tokens[t]}`).join(', ')}`,
    `  backgrounds: ${Object.keys(r.backgrounds).join(', ') || 'none'}${r.logo ? '; a logo' : ''}`,
    '',
    'Not carried over:',
    ...r.notCarried.map((n) => `  - ${n}`),
    ...(r.notes.length ? ['', ...r.notes.map((n) => `note: ${n}`)] : []),
    '',
    'Look at it (saving brand.css restyles the page):',
    `  npx blitzstrahl dev ${show(join(r.outDir, 'sample.md'))}`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
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


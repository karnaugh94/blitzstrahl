/**
 * A problem with how blitzstrahl was asked to run (a path it won't write, a
 * flag it doesn't know), as opposed to a problem in the deck. The CLI prints
 * the message as one line, with no stack trace, and exits with `exitCode`.
 */
export class CliError extends Error {
  constructor(
    message: string,
    /** 2: the command line asked for something blitzstrahl won't do. */
    readonly exitCode = 2,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

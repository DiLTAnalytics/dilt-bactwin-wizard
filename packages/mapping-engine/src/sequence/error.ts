/** A sequence file that does not match its format; the message lists every problem. */
export class SequenceFormatError extends Error {}

/** A sequence file of a newer format than this engine knows: reading it would lose what is new. */
export class SequenceTooNewError extends SequenceFormatError {
  /** The file, when the caller knows it. */
  file: string | null = null

  constructor(readonly version: string) {
    super(`format ${version} is newer than this version reads`)
  }
}

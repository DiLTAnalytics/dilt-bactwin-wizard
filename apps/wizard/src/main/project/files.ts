import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { rename, rm } from 'node:fs/promises'
import { finished } from 'node:stream/promises'

/**
 * Write to a temporary file next to `path`, then rename it over `path`, so a crash or a failed write
 * never leaves a half-written file.
 */
export async function writeFileSafely(path: string, content: string | Iterable<string>): Promise<void> {
  const temp = `${path}.saving`
  const out = createWriteStream(temp, { encoding: 'utf8' })
  try {
    for (const chunk of typeof content === 'string' ? [content] : content) {
      if (!out.write(chunk)) await once(out, 'drain')
    }
    out.end()
    await finished(out)
    await rename(temp, path)
  } catch (e) {
    out.destroy()
    await rm(temp, { force: true })
    throw e
  }
}

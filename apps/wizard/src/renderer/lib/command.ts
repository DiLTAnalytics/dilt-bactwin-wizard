import type { Command } from '@bactwin/mapping-engine'
import type { Translate } from './fieldLabel'

/** The exceptions first; replace is what a point has unless a step says otherwise. */
export const COMMAND_CHOICES: Command[] = ['ignore', 'doNotParse', 'replace']

export const commandOptions = (t: Translate) => COMMAND_CHOICES.map((c) => ({ value: c, label: t(`command.${c}`) }))

import type { StepPosition } from '@/lib/stepPositions'
import { invoke } from './client'

export const getSequence = () => invoke('sequence:get')
export const deleteStep = (index: number) => invoke('sequence:deleteStep', index)
export const moveStepTo = (index: number, to: StepPosition) => invoke('sequence:moveStep', index, to)
export const moveSequenceBlock = (from: number, to: number) => invoke('sequence:moveBlock', from, to)
export const setStepDisabled = (index: number, disabled: boolean) => invoke('sequence:setDisabled', index, disabled)
/** Main asks for the files; null when cancelled. */
export const linkSequenceFile = () => invoke('sequence:link')
export const unlinkSequenceBlock = (block: number) => invoke('sequence:unlink', block)
/** Main asks where the new file goes; null when cancelled. */
export const createSequenceFile = () => invoke('sequence:create')
/** Main asks for the file of a block that was not found; null when cancelled. */
export const locateSequenceFile = (block: number) => invoke('sequence:locate', block)
/** Write a file deleted while open back to where it was. */
export const restoreSequenceFile = (block: number) => invoke('sequence:restore', block)
/** Main asks where the file goes; null when cancelled. */
export const saveSequenceFileAs = (block: number) => invoke('sequence:saveAs', block)

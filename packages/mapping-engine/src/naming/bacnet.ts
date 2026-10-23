import type { ReferenceData } from '../reference/index.js'
import type { DataPoint } from '../types.js'

/**
 * Derive the readable BACnet type and unit from the EDE codes. Always re-derived, to "" on a miss,
 * so a stale value never sits next to a changed code.
 */
export function translateBacnetFields(points: DataPoint[], ref: ReferenceData): void {
  for (const p of points) {
    const t = p.ede.object_type === null ? undefined : ref.bacnetTypes[String(p.ede.object_type)]
    p.bacnet.type = t ? t.acronym || t.bacnet_object_type : ''
    const u = p.ede.unit_code === null ? undefined : ref.bacnetUnits[String(p.ede.unit_code)]
    p.bacnet.unit = u?.unit ?? ''
  }
}

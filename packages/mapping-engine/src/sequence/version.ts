/** Whether format version `a` ("major.minor") is newer than `b`. */
export function isNewer(a: string, b: string): boolean {
  const [am = 0, an = 0] = a.split('.').map(Number)
  const [bm = 0, bn = 0] = b.split('.').map(Number)
  return am > bm || (am === bm && an > bn)
}

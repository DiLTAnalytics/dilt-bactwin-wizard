import { buildNameParts, type BACtwinData, type NameTemplate } from '@bactwin/mapping-engine'

/** A BACtwin name with its unfilled placeholders shown faint; `label` shows keys by their label instead. */
export function BACtwinName({ bt, template, label, wrap = false }: {
  bt: BACtwinData
  template: NameTemplate
  label?: (block: string, key: string) => string
  wrap?: boolean
}) {
  const segments = buildNameParts(template, bt, label)
  return (
    <span className={`font-mono text-xs ${wrap ? 'break-all' : 'whitespace-nowrap'}`}>
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span className="text-faint">{template.separator}</span>}
          {seg.parts.map((part, j) => (
            <span key={j} className={part.filled ? 'text-fg-2' : 'text-faint'}>
              {part.text}
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

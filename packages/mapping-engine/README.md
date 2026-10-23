# @bactwin/mapping-engine

Translates BACnet data-point names onto the BACtwin naming standard: EDE parsing, filters,
assignments, combination checks, validation and replaying a mapping sequence. `AGPL-3.0-only`.

## Rules

- **Pure:** no `fs`, `path`, `process`, clock, randomness, locale-dependent sorting or console
  output. Callers pass content in. `test/purity.test.ts` enforces it.
- **Guidance, never refusal:** combinations narrow the options and warn afterwards; they never block
  a write. Don't add a rejection path to `apply/`.
- **All or nothing:** `bactwin_name` stays empty until every required segment is set;
  `bactwin_description` shows partial progress.

## Layout

| Module | Responsibility |
|---|---|
| `types.ts` | Domain model, zod schemas, serialisation |
| `reference/` | Key libraries, BACnet tables, combination catalogue (indexed once for fast lookups) |
| `parse/` | EDE CSV reader |
| `filter/` | Filter DSL and evaluator |
| `naming/` | Name and description assembly, field writes, point identity, BACnet translation |
| `combinations/` | The three strictness modes and the violation check |
| `validate/` | Per-point validation and duplicate names |
| `apply/` | Writing assignments and flags onto a selection |
| `sequence/` | File format, replay |

## Tests

```bash
pnpm --filter @bactwin/mapping-engine test
```

`conformance.test.ts` replays the [fixtures](test/fixtures/README.md), `corpus.test.ts` checks them
against [`schema/`](schema/), `purity.test.ts` enforces purity.

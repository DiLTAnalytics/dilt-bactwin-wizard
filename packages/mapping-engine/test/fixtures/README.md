# Conformance corpus

Language-neutral `input -> expected output` fixtures that define what the mapping engine must do.
Any implementation, in any language, can prove itself against them.

## Layout (in `packages/mapping-engine`)

```
test/fixtures/<group>/*.json   one case per file
test/fixtures/index.json       list of every fixture
test/reference/demo.json       small synthetic reference data
schema/                        sequence file format and fixture shape
test/corpus.test.ts            checks fixtures against the schemas and the index
test/conformance.test.ts       replays every fixture through the engine
```

Most fixtures use the synthetic `demo` bundle, so each fails for one clear reason. The BACnet tables
are real (they are facts). The `bundled` bundle uses the repository's plugins, for import cases.

## Groups

`parse-ede`, `identity`, `filter`, `naming`, `combinations`, `validation`, `apply`, `export`, `sequence`.

## Changing a fixture

Fixtures are edited by hand; there is no generator, because it would derive the expected output from
the engine under test. If engine and corpus disagree, one of them is a bug: find out which first. A
behaviour change updates its fixtures in the same commit, with the reason in the pull request.

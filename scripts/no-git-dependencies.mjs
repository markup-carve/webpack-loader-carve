#!/usr/bin/env node
// Refuse to publish unless the engine is declared as a registry version.
//
//   node scripts/no-git-dependencies.mjs [package.json]
//
// A `github:` or `git+` specifier installs fine here and breaks a consumer:
// npm hands them a spec that needs git and a build step. It was reintroduced
// by #8. Called from release.yml only: between releases main may pin a merged
// carve-js commit, and test/engine-dependency.test.mjs runs this on every PR.
import { readFileSync } from 'node:fs'

const manifestPath = process.argv[2] ?? 'package.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const spec =
  manifest.dependencies?.['@markup-carve/carve'] ??
  manifest.devDependencies?.['@markup-carve/carve']

if (!spec) {
  console.error('::error::@markup-carve/carve is not declared')
  process.exit(1)
}

if (!/^[\^~]?\d+\.\d+\.\d+/.test(spec)) {
  console.error(`::error::@markup-carve/carve is declared as ${spec}, not a registry version.`)
  console.error('Point it at a published engine release before publishing.')
  process.exit(1)
}

console.log(`@markup-carve/carve ${spec} resolves from the registry`)

#!/usr/bin/env node
// Refuse to publish unless the engine is declared as a registry version.
//
//   node scripts/no-git-dependencies.mjs [package.json]
//
// A `github:` or `git+` specifier installs fine here and breaks a consumer:
// npm hands them a spec that needs git and a build step. It was reintroduced
// by #8. Called from release.yml only: between releases main may pin a merged
// carve-js commit, and test/engine-dependency.test.mjs runs this on every PR.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

// `npm ci` installs what the lockfile resolved, so a lockfile left on the git
// pin would test a different engine than consumers get.
const lockPath = join(dirname(manifestPath), 'package-lock.json')
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const resolved = lock.packages?.['node_modules/@markup-carve/carve']?.resolved
  if (!resolved?.startsWith('https://registry.npmjs.org/')) {
    console.error(`::error::package-lock.json resolves @markup-carve/carve to ${resolved}, not the registry.`)
    console.error('Run npm install after pointing the manifest at a published release.')
    process.exit(1)
  }
}

console.log(`@markup-carve/carve ${spec} resolves from the registry`)

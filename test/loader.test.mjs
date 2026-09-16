import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import webpack from 'webpack'

const root = path.resolve(import.meta.dirname, '..')

test('a real webpack build imports rendered HTML and metadata', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-'))
  await writeFile(path.join(dir, 'page.crv'), '---\ntitle: Loader\n---\n\n# Hello\n\nA *strong* result.\n')
  await writeFile(path.join(dir, 'index.js'), "export {default, source, frontmatter} from './page.crv'\n")

  await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js', output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs') }] }] },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errors: true, warnings: true })))
      resolve()
    })
  })

  const output = await readFile(path.join(dir, 'dist', 'bundle.cjs'), 'utf8')
  await writeFile(path.join(dir, 'dist', 'bundle-copy.cjs'), output)
  const result = await import(`${path.join(dir, 'dist', 'bundle-copy.cjs')}?t=${Date.now()}`)
  const exports = result.default
  assert.match(exports.default, /<h1[^>]*>Hello<\/h1>/)
  assert.match(exports.default, /<strong>strong<\/strong>/)
  assert.equal(exports.frontmatter.format, 'yaml')
  assert.match(exports.frontmatter.content, /title: Loader/)
  assert.match(exports.source, /# Hello/)
})

test('a build expands an include relative to its document', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-include-'))
  await writeFile(path.join(dir, 'shared.crv'), 'Included text.')
  await writeFile(path.join(dir, 'page.crv'), '{{ shared.crv }}')
  await writeFile(path.join(dir, 'index.js'), "export {default} from './page.crv'\n")

  await new Promise((resolve, reject) => {
    webpack({
      mode: 'production', target: 'node', context: dir,
      entry: './index.js', output: { path: path.join(dir, 'dist'), filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      module: { rules: [{ test: /\.crv$/, use: [{ loader: path.join(root, 'loader.cjs') }] }] },
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errors: true, warnings: true })))
      resolve()
    })
  })

  const result = await import(`${path.join(dir, 'dist', 'bundle.cjs')}?t=${Date.now()}`)
  assert.match(result.default.default, /Included text\./)
})

test('refuses a relative include root instead of rooting it at the cwd', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'webpack-carve-relroot-'))
  const { default: carveLoader } = await import(pathToFileURL(path.join(root, 'loader.cjs')).href)

  const error = await new Promise((resolve) => {
    carveLoader.call({
      async: () => (err) => resolve(err),
      getOptions: () => ({ includeRoot: '..' }),
      rootContext: dir,
      resourcePath: path.join(dir, 'page.crv'),
      addDependency() {},
      emitWarning() {},
    }, '{{ shared.crv }}')
  })

  assert.match(error.message, /absolute path/)
})

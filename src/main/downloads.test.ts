import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { DownloadWatcher, isCandidate, type Download } from './downloads'
import { extractText, fileKind } from './files'

const dir = mkdtempSync(join(tmpdir(), 'klair-dl-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('temporary and hidden names are not downloads', () => {
  assert.equal(isCandidate('paper.pdf'), true)
  assert.equal(isCandidate('paper.pdf.crdownload'), false)
  assert.equal(isCandidate('video.mp4.part'), false)
  assert.equal(isCandidate('Report.pdf.download'), false)
  assert.equal(isCandidate('.DS_Store'), false)
  assert.equal(isCandidate('~$draft.docx'), false)
})

test('a finished download is reported once; files already there are not', async () => {
  writeFileSync(join(dir, 'old.pdf'), 'already here')
  const seen: Download[] = []
  const w = new DownloadWatcher(dir, (d) => seen.push(d), undefined, 200)
  // Files more than 2 s older than the start are ignored; "old.pdf" will be 2.6 s old.
  await wait(2600)
  w.start()
  // A browser writes to a temporary name, then renames it when done.
  writeFileSync(join(dir, 'notes.txt.crdownload'), 'half')
  await wait(600)
  assert.equal(seen.length, 0)
  renameSync(join(dir, 'notes.txt.crdownload'), join(dir, 'notes.txt'))
  await wait(400)
  writeFileSync(join(dir, 'notes.txt'), 'the whole file')
  await wait(1500)
  w.stop()
  assert.deepEqual(
    seen.map((d) => d.name),
    ['notes.txt']
  )
  assert.equal(seen[0].size, 'the whole file'.length)
})

test('text comes out of text, rich text and PDF files', async () => {
  assert.equal(fileKind('a.PDF'), 'pdf')
  assert.equal(fileKind('deck.pptx'), 'slides')
  assert.equal(fileKind('photo.heic'), 'image')
  assert.equal(fileKind('setup.dmg'), 'other')

  writeFileSync(join(dir, 'a.md'), '# Learning rate\n\n\n\nStep size.\r\n')
  const md = await extractText(join(dir, 'a.md'), 'a.md')
  assert.deepEqual([md.status, md.text], ['ok', '# Learning rate\n\nStep size.'])

  writeFileSync(join(dir, 'bin.txt'), Buffer.from([1, 0, 2, 0]))
  assert.equal((await extractText(join(dir, 'bin.txt'), 'bin.txt')).status, 'failed')
  assert.equal((await extractText(join(dir, 'x.dmg'), 'x.dmg')).status, 'unsupported')

  if (process.platform !== 'darwin') return
  writeFileSync(join(dir, 'b.rtf'), '{\\rtf1\\ansi Gradient {\\b descent}}')
  assert.equal((await extractText(join(dir, 'b.rtf'), 'b.rtf')).text, 'Gradient descent')
  // A real PDF, printed by macOS from a text file.
  writeFileSync(join(dir, 'c.txt'), 'Momentum keeps the update moving.')
  const pdf = execFileSync('/usr/sbin/cupsfilter', [join(dir, 'c.txt')], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  writeFileSync(join(dir, 'c.pdf'), pdf)
  const out = await extractText(join(dir, 'c.pdf'), 'c.pdf')
  assert.equal(out.status, 'ok')
  assert.match(out.text, /Momentum keeps the update moving/)
})

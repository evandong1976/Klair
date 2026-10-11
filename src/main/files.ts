import { execFile } from 'child_process'
import { open, readFile, unlink } from 'fs/promises'
import { extname, join } from 'path'
import { promisify } from 'util'

// Text out of a file the user added to the session (from Downloads). Uses what macOS
// already has, so there are no extra dependencies:
//   PDF                         PDFKit, through JavaScript for Automation (osascript)
//   doc/docx/rtf/odt/html/...   textutil
//   pptx / xlsx                 their XML parts (unzip), tags stripped
//   code, text and data files   read as UTF-8
// Images are described by the vision model instead (controller.ts); anything else is
// kept with its name only.

const run = promisify(execFile)

export type FileKind = 'pdf' | 'document' | 'slides' | 'spreadsheet' | 'text' | 'image' | 'other'

export interface Extracted {
  kind: FileKind
  text: string
  status: 'ok' | 'empty' | 'unsupported' | 'failed'
  truncated: boolean
  detail?: string
}

/** Characters of extracted text kept per file. */
export const MAX_FILE_CHARS = 500_000

const DOCUMENT = [
  '.doc',
  '.docx',
  '.rtf',
  '.rtfd',
  '.odt',
  '.html',
  '.htm',
  '.webarchive',
  '.wordml'
]
const IMAGE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']
const TEXT = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.ipynb',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.log',
  '.tex',
  '.bib',
  '.srt',
  '.vtt',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sh',
  '.zsh',
  '.sql',
  '.r',
  '.m',
  '.scala',
  '.lua',
  '.css'
]

export function fileKind(name: string): FileKind {
  const ext = extname(name).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.pptx') return 'slides'
  if (ext === '.xlsx') return 'spreadsheet'
  if (DOCUMENT.includes(ext)) return 'document'
  if (IMAGE.includes(ext)) return 'image'
  if (TEXT.includes(ext)) return 'text'
  return 'other'
}

const PDF_SCRIPT = `
ObjC.import('PDFKit')
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  if (doc.isNil()) throw new Error('Not a readable PDF')
  const s = doc.string
  return s.isNil() ? '' : s.js
}`

const opts = { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }

async function pdfText(path: string): Promise<string> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', PDF_SCRIPT, path], opts)
  return stdout
}

async function documentText(path: string): Promise<string> {
  const { stdout } = await run('textutil', ['-convert', 'txt', '-stdout', path], opts)
  return stdout
}

/** Text runs from an Office Open XML file's parts (slides or shared strings). */
async function officeText(path: string, parts: string[], tag: RegExp): Promise<string> {
  const { stdout } = await run('unzip', ['-p', path, ...parts], opts)
  const runs = [...stdout.matchAll(tag)].map((m) => decodeXml(m[1]))
  return runs.join('\n')
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function plainText(path: string): Promise<string> {
  // Refuse binary files that only look like text by their name.
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(head, 0, head.length, 0)
    if (head.subarray(0, bytesRead).includes(0)) throw new Error('Binary file')
  } finally {
    await fh.close()
  }
  return readFile(path, 'utf8')
}

/**
 * An image file in a form the vision model takes (HEIC is converted to JPEG with sips).
 * `tmpDir` holds the converted copy.
 */
export async function imageForModel(
  path: string,
  name: string,
  tmpDir: string
): Promise<{ data: Buffer; mediaType: string }> {
  const ext = extname(name).toLowerCase()
  if (ext === '.heic') {
    const out = join(tmpDir, `${Date.now()}.jpg`)
    await run('sips', ['-s', 'format', 'jpeg', path, '--out', out], opts)
    try {
      return { data: await readFile(out), mediaType: 'image/jpeg' }
    } finally {
      await unlink(out).catch(() => {})
    }
  }
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  }
  return { data: await readFile(path), mediaType: types[ext] ?? 'image/png' }
}

/** Extract a file's text. Images return status 'unsupported' here (described elsewhere). */
export async function extractText(path: string, name: string): Promise<Extracted> {
  const kind = fileKind(name)
  let raw: string
  try {
    switch (kind) {
      case 'pdf':
        raw = await pdfText(path)
        break
      case 'document':
        raw = await documentText(path)
        break
      case 'slides':
        raw = await officeText(path, ['ppt/slides/slide*.xml'], /<a:t>([^<]*)<\/a:t>/g)
        break
      case 'spreadsheet':
        raw = await officeText(path, ['xl/sharedStrings.xml'], /<t[^>]*>([^<]*)<\/t>/g)
        break
      case 'text':
        raw = await plainText(path)
        break
      default:
        return { kind, text: '', status: 'unsupported', truncated: false }
    }
  } catch (err) {
    return {
      kind,
      text: '',
      status: 'failed',
      truncated: false,
      detail: (err as Error).message.slice(0, 200)
    }
  }
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    kind,
    text: text.slice(0, MAX_FILE_CHARS),
    status: text ? 'ok' : 'empty',
    truncated: text.length > MAX_FILE_CHARS
  }
}

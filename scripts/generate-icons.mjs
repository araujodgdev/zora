// Renders scripts/app-icon.html into the PNG/ICO icons under public/ with a
// headless Chrome or Edge (set CHROME_PATH to use another binary).
// Run after changing the icon: `node scripts/generate-icons.mjs`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = pathToFileURL(join(root, 'scripts', 'app-icon.html')).href

/** [output path under public/, variant, size in px] */
const ICONS = [
  ['icons/icon-192.png', 'any', 192],
  ['icons/icon-512.png', 'any', 512],
  ['icons/maskable-192.png', 'maskable', 192],
  ['icons/maskable-512.png', 'maskable', 512],
  ['apple-touch-icon.png', 'apple', 180],
  ['icons/favicon-32.png', 'favicon', 32],
]
/** Sizes packed into public/favicon.ico (the path browsers ask for). */
const FAVICON_SIZES = [16, 32, 48]

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const found = candidates.find((path) => path && existsSync(path))
  if (!found) throw new Error('Chrome or Edge not found; set CHROME_PATH.')
  return found
}

const browser = findBrowser()
const profile = mkdtempSync(join(tmpdir(), 'zora-icons-'))

function render(variant, size) {
  const out = join(profile, `${variant}-${size}.png`)
  // A fresh browser profile per render: reusing one can hand the command to
  // a still-running instance and hang.
  const userDataDir = mkdtempSync(join(profile, 'chrome-'))
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--default-background-color=00000000',
    // Draw at 512 CSS px and scale the pixels: headless Chrome enforces a
    // minimum window size, so a small window would crop the page.
    `--force-device-scale-factor=${size / 512}`,
    `--user-data-dir=${userDataDir}`,
    // Wait for the font before the screenshot.
    '--virtual-time-budget=3000',
    '--window-size=512,512',
    `--screenshot=${out}`,
    `${source}#${variant}`,
  ], { stdio: 'ignore', timeout: 60_000 })
  return readFileSync(out)
}

/** An ICO file whose entries are PNGs (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

try {
  mkdirSync(join(root, 'public', 'icons'), { recursive: true })
  for (const [path, variant, size] of ICONS) {
    writeFileSync(join(root, 'public', path), render(variant, size))
    console.log(`public/${path}`)
  }
  const favicons = FAVICON_SIZES.map((size) => ({ size, png: render('favicon', size) }))
  writeFileSync(join(root, 'public', 'favicon.ico'), ico(favicons))
  console.log('public/favicon.ico')
} finally {
  // Chrome can still hold files in the profile for a moment after exiting.
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}

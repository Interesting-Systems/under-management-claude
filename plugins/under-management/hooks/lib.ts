/**
 * The plain parts of the mod, with no mods API in them, so the tests can call them directly:
 * the session code, how to open a window on each platform, and the command's arguments.
 */

/** Where the game is served. The companion edition is the same build at /companion. */
export const GAME_URL = 'https://under-management.vercel.app/companion'

/** The window: 960 × 600 of game, plus the title bar Chrome draws above it. */
export const WINDOW = { width: 960, height: 632 }

export type Settings = {
  /** Open the window without asking once Claude has worked this long. Off by default. */
  autoOpen: boolean
  /** Seconds of work before the strip offers the game (or the window opens on its own). */
  delaySec: number
  /** Show the strip at all. With it off, /under-management still opens the game. */
  strip: boolean
}

export const DEFAULTS: Settings = { autoOpen: false, delaySec: 20, strip: true }

/** The delay is kept between these, in seconds. */
export const DELAY_MIN = 5
export const DELAY_MAX = 600

/** Crockford's base32 without I, L, O and U, the alphabet the game's relay checks codes against. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A fresh 16-character code for this session: 80 random bits. It's the only key to the relay's
 * record of "working" or "ready", and it lives only in this session and in the window's address.
 */
export function newCode(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(16)
  let out = ''
  for (const b of bytes) out += ALPHABET[b & 31]
  return out
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export type Platform = 'mac' | 'windows' | 'linux'

/** What a window needs: an app window of its own, at our size, in a profile of its own. */
function chromeFlags(url: string, profile: string): string[] {
  return [
    `--app=${url}`,
    `--window-size=${WINDOW.width},${WINDOW.height}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]
}

/** On Linux, the first Chromium-family browser on the PATH, else the default browser. */
const LINUX_OPEN = [
  'url="$1"; shift',
  'for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do',
  '  if command -v "$b" >/dev/null 2>&1; then "$b" "$@" >/dev/null 2>&1 & exit 0; fi',
  'done',
  'xdg-open "$url" >/dev/null 2>&1 &',
].join('\n')

/**
 * The commands to try, in order, to open the game. Each returns at once (`$.process.run` waits
 * for its command to exit, so the browser itself is never the command). The first that exits 0
 * wins; the last of each list opens the default browser instead.
 */
export function launchers(platform: Platform, url: string, profile: string): string[][] {
  const flags = chromeFlags(url, profile)
  if (platform === 'mac')
    return [
      ...['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map((app) => [
        'open',
        '-na',
        app,
        '--args',
        ...flags,
      ]),
      ['open', url],
    ]
  if (platform === 'windows')
    // Edge comes with Windows, so it's the one to ask for; `start` takes the first quoted
    // argument as a window title, which is what "Under Management" is here.
    return [
      ['cmd', '/c', 'start', 'Under Management', 'msedge', ...flags],
      ['cmd', '/c', 'start', 'Under Management', url],
    ]
  return [['sh', '-c', LINUX_OPEN, 'sh', url, ...flags]]
}

/** The address the window opens: the game, told which session's relay to listen to. */
export function windowUrl(base: string, code: string): string {
  const u = new URL(base)
  u.searchParams.set('companion', code)
  return u.toString()
}

/** Where the relay is: the game's own site. */
export function relayUrl(base: string): string {
  return `${new URL(base).origin}/api/companion`
}

export type Parsed =
  | { kind: 'open' }
  | { kind: 'help' }
  | { kind: 'set'; change: Partial<Settings> }
  | { kind: 'error'; text: string }

const onOff = (w: string | undefined): boolean | null => (w === 'on' ? true : w === 'off' ? false : null)

/** `/under-management [auto on|off] [delay <seconds>] [strip on|off]`, or `help`. */
export function parseArgs(args: string): Parsed {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'open' }
  if (words[0] === 'help' || words[0] === 'settings' || words[0] === 'status') return { kind: 'help' }
  const change: Partial<Settings> = {}
  for (let i = 0; i < words.length; i += 2) {
    const [key, value] = [words[i], words[i + 1]]
    if (key === 'auto' || key === 'strip') {
      const v = onOff(value)
      if (v === null) return { kind: 'error', text: `"${key}" takes on or off.` }
      if (key === 'auto') change.autoOpen = v
      else change.strip = v
    } else if (key === 'delay') {
      const n = Number(value?.replace(/s$/, ''))
      if (!Number.isFinite(n) || n < DELAY_MIN || n > DELAY_MAX)
        return { kind: 'error', text: `"delay" takes a number of seconds from ${DELAY_MIN} to ${DELAY_MAX}.` }
      change.delaySec = Math.round(n)
    } else {
      return { kind: 'error', text: `Not a setting: "${key}". Try /under-management help.` }
    }
  }
  return { kind: 'set', change }
}

/** Settings from the store, with anything missing or malformed at its default. */
export function readSettings(saved: unknown): Settings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof Settings, unknown>>
  const delay = Number(s.delaySec)
  return {
    autoOpen: typeof s.autoOpen === 'boolean' ? s.autoOpen : DEFAULTS.autoOpen,
    delaySec: Number.isFinite(delay) && delay >= DELAY_MIN && delay <= DELAY_MAX ? delay : DEFAULTS.delaySec,
    strip: typeof s.strip === 'boolean' ? s.strip : DEFAULTS.strip,
  }
}

/** The settings as one line. */
export function describe(s: Settings): string {
  return [
    `Opens on its own: ${s.autoOpen ? 'on' : 'off'}`,
    `after ${s.delaySec} s of work`,
    `strip ${s.strip ? 'on' : 'off'}`,
  ].join(' · ')
}

export const HELP = [
  '/under-management                 open the game in its own window now',
  '/under-management auto on|off     open it on its own once Claude has worked a while (off by default)',
  '/under-management delay <s>       how long Claude works before the offer (20 s by default)',
  '/under-management strip on|off    show the offer above the prompt at all',
].join('\n')

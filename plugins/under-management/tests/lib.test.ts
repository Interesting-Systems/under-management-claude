/**
 * The plain parts of the mod, called directly.
 */
import { expect, test } from 'claude-code/testing'

import {
  DEFAULTS,
  GAME_URL,
  launchers,
  newCode,
  parseArgs,
  readSettings,
  relayUrl,
  windowUrl,
} from '../hooks/lib'

const WINDOW_URL = 'https://under-management.vercel.app/companion?companion=ABC'
const PROFILE = '/home/me/.under-management/window'

// The relay rejects codes outside its alphabet, so the mod must never mint one.
test('newCode makes 16 characters of the relay alphabet, and a new one each time', () => {
  const code = newCode()
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
  expect(newCode()).not.toBe(code)

  // Feed it every byte value: only 32 symbols come out, and never I, L, O or U.
  const seen = new Set<string>()
  for (let start = 0; start < 256; start += 16) {
    for (const c of newCode(() => Uint8Array.from({ length: 16 }, (_, i) => start + i))) seen.add(c)
  }
  expect(seen.size).toBe(32)
  expect([...seen].join('')).not.toMatch(/[ILOU]/)
  expect(newCode(() => Uint8Array.from({ length: 16 }, (_, i) => i))).toBe('0123456789ABCDEF')
})

test('windowUrl and relayUrl point at the game and its relay', () => {
  expect(windowUrl(GAME_URL, 'ABC')).toBe(WINDOW_URL)
  expect(relayUrl(GAME_URL)).toBe('https://under-management.vercel.app/api/companion')
  // For trying the mod against a local copy of the game.
  expect(relayUrl('http://localhost:5173/companion')).toBe('http://localhost:5173/api/companion')
})

// A launcher that is wrong for its platform fails silently, so pin each platform's first choice.
test('launchers: a Mac tries four Chromium-family apps, then the default browser', () => {
  const list = launchers('mac', WINDOW_URL, PROFILE)
  expect(list).toHaveLength(5)
  expect(list[0]).toEqual([
    'open',
    '-na',
    'Google Chrome',
    '--args',
    `--app=${WINDOW_URL}`,
    '--window-size=960,632',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
  ])
  expect(list.slice(0, 4).map((argv) => argv[2])).toEqual(['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'])
  expect(list[4]).toEqual(['open', WINDOW_URL])
})

test('launchers: Windows asks for Edge, then the default browser', () => {
  const list = launchers('windows', WINDOW_URL, 'C:\\Users\\me\\window')
  expect(list).toHaveLength(2)
  expect(list[0]?.slice(0, 5)).toEqual(['cmd', '/c', 'start', 'Under Management', 'msedge'])
  expect(list[0]).toContain(`--app=${WINDOW_URL}`)
  expect(list[0]).toContain('--user-data-dir=C:\\Users\\me\\window')
  expect(list[1]).toEqual(['cmd', '/c', 'start', 'Under Management', WINDOW_URL])
})

test('launchers: Linux runs one shell script given the address, then the app flags', () => {
  const list = launchers('linux', WINDOW_URL, PROFILE)
  expect(list).toHaveLength(1)
  const argv = list[0] ?? []
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv[2]).toContain('xdg-open')
  expect(argv.slice(3)).toEqual([
    'sh',
    WINDOW_URL,
    `--app=${WINDOW_URL}`,
    '--window-size=960,632',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
  ])
})

test('parseArgs: nothing opens the game, help and its aliases show the settings', () => {
  expect(parseArgs('')).toEqual({ kind: 'open' })
  expect(parseArgs('   ')).toEqual({ kind: 'open' })
  for (const word of ['help', 'settings', 'status']) expect(parseArgs(word)).toEqual({ kind: 'help' })
})

test('parseArgs: settings, alone or together, in any case', () => {
  expect(parseArgs('auto on')).toEqual({ kind: 'set', change: { autoOpen: true } })
  expect(parseArgs('STRIP Off')).toEqual({ kind: 'set', change: { strip: false } })
  expect(parseArgs('delay 30')).toEqual({ kind: 'set', change: { delaySec: 30 } })
  expect(parseArgs('delay 30s')).toEqual({ kind: 'set', change: { delaySec: 30 } })
  expect(parseArgs('delay 30.4')).toEqual({ kind: 'set', change: { delaySec: 30 } })
  expect(parseArgs('auto on delay 45 strip off')).toEqual({
    kind: 'set',
    change: { autoOpen: true, delaySec: 45, strip: false },
  })
})

test('parseArgs: junk is refused with a message that names the problem', () => {
  const errorOf = (args: string) => {
    const p = parseArgs(args)
    return p.kind === 'error' ? p.text : `not an error: ${p.kind}`
  }
  expect(errorOf('delay 3')).toMatch(/from 5 to 600/)
  expect(errorOf('delay 601')).toMatch(/from 5 to 600/)
  expect(errorOf('delay')).toMatch(/"delay" takes a number/)
  expect(errorOf('delay soon')).toMatch(/"delay" takes a number/)
  expect(errorOf('auto maybe')).toMatch(/"auto" takes on or off/)
  expect(errorOf('auto')).toMatch(/"auto" takes on or off/)
  expect(errorOf('strip 1')).toMatch(/"strip" takes on or off/)
  expect(errorOf('colour red')).toMatch(/Not a setting: "colour"/)
  expect(errorOf('auto on volume 11')).toMatch(/Not a setting: "volume"/)
})

// The store is shared between sessions and can hold anything; junk must fall back, not throw.
test('readSettings: missing or malformed values fall back to their defaults', () => {
  for (const junk of [undefined, null, 'nope', 42, true, [], {}]) expect(readSettings(junk)).toEqual(DEFAULTS)
  expect(readSettings({ autoOpen: 'yes', delaySec: 'soon', strip: 1 })).toEqual(DEFAULTS)
  expect(readSettings({ delaySec: 4 })).toEqual(DEFAULTS)
  expect(readSettings({ delaySec: 601 })).toEqual(DEFAULTS)
  expect(readSettings({ delaySec: NaN })).toEqual(DEFAULTS)
  expect(readSettings({ autoOpen: true, delaySec: 45, strip: false })).toEqual({
    autoOpen: true,
    delaySec: 45,
    strip: false,
  })
  // One good field survives its bad neighbors.
  expect(readSettings({ autoOpen: true, delaySec: 'x' })).toEqual({ ...DEFAULTS, autoOpen: true })
})

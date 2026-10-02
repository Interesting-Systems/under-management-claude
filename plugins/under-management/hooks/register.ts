/**
 * Under Management, while Claude works.
 *
 * After Claude has worked on a turn for a while (20 s by default), a strip above the prompt offers
 * the game: press 1 and it opens in a window of its own, 960 × 600, beside Claude Code. When the
 * turn ends, the game pauses itself and says Claude has finished.
 *
 * Mods can't draw a game inside Claude Code, so the game is a web page in a Chrome or Edge app
 * window. To tell it when Claude finishes, the mod posts to the game's site, under a random code
 * made for this session: "working" and when it started, or "ready" and how long it took. Nothing
 * else: no prompt, no answer, no file. Nothing is sent at all until the window has been opened.
 */
import type { EngineInterface, On } from 'claude-code'
import {
  DEFAULTS,
  describe,
  GAME_URL,
  HELP,
  launchers,
  newCode,
  type Platform,
  parseArgs,
  readSettings,
  relayUrl,
  type Settings,
  windowUrl,
} from './lib'

const STORE_KEY = 'settings'

let settings: Settings = { ...DEFAULTS }
/** This session's code for the relay. */
let code = ''
/** A person is at the prompt. In a `-p` run there's nobody to play, so the mod does nothing. */
let interactive = false
let gameUrl = GAME_URL
let platform: Platform | null = null
let profile = ''

/** The main loop's turn is running, since when (by `$.clock.now()`). */
let working = false
let turnStartedAt = 0
/** The strip is up for this turn. */
let offered = false
/** The window has been opened in this session: from then on the relay hears every turn. */
let opened = false
let timer: { cancel(): void } | null = null

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    if (!interactive) return next(e)
    code = newCode()
    settings = readSettings(await $.store.get(STORE_KEY))
    // For trying the mod against a local copy of the game.
    const url = await $.env.get('UNDER_MANAGEMENT_URL')
    if (url) gameUrl = url
    try {
      await $.command.register({
        name: 'under-management',
        description: 'Open Under Management in its own window, or change when it offers itself',
        argumentHint: '[auto on|off] [delay <seconds>] [strip on|off] [help]',
        immediate: true,
      })
    } catch {
      // Taken by another plugin: the strip still works.
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!interactive) return next(e)
    working = true
    offered = false
    turnStartedAt = await $.clock.now()
    timer?.cancel()
    timer = $.clock.after(settings.delaySec * 1000, () => offer($))
    if (opened) relay($, { state: 'working', since: turnStartedAt })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's run ends with a turn.complete of its own; only the main loop's counts.
    if (!interactive || e.agentId || !working) return next(e)
    working = false
    timer?.cancel()
    timer = null
    if (offered) {
      offered = false
      $.ui.invalidate('ui.render')
    }
    if (opened) {
      const now = await $.clock.now()
      relay($, { state: 'ready', since: turnStartedAt, workedMs: Math.max(0, now - turnStartedAt) })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!offered || !settings.strip || !e.props.isWorking || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const wide = e.props.bodyColumns >= 76
    // One row, no border: a band taller than its maxRows scrolls, and then a bare 1 presses nothing.
    const strip = Box({
      key: 'under-management',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingX: 1,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ children: ['Claude is still working.'] }),
            Button({
              key: 'play',
              label: opened ? 'Open Under Management again' : 'Play Under Management',
              hotkey: '1',
              plain: true,
              onPress: () => openGame($),
            }),
          ],
        }),
        ...(wide
          ? [Text({ dimColor: true, children: [`Opens on its own: ${settings.autoOpen ? 'on' : 'off'} · /under-management`] })]
          : []),
      ],
    })
    return Box({ flexDirection: 'column', children: [strip, theirs] })
  })

  on('command.run', { command: 'under-management' }, async ($, e) => {
    const p = parseArgs(e.args ?? '')
    if (p.kind === 'help') return { text: `${HELP}\n\nNow: ${describe(settings)}.` }
    if (p.kind === 'error') return { text: p.text }
    if (p.kind === 'set') {
      // Read again before writing: another session may have changed them since this one started.
      settings = { ...readSettings(await $.store.get(STORE_KEY)), ...p.change }
      await $.store.set(STORE_KEY, settings)
      $.ui.invalidate('ui.render')
      return { text: `Saved. ${describe(settings)}.` }
    }
    const ok = await openGame($)
    return ok ? {} : { text: `No browser window would open. The game is at ${windowUrl(gameUrl, code)}` }
  })
}

/** Claude has worked long enough: offer the game, or open it if that's the setting. */
async function offer($: EngineInterface) {
  if (!working) return
  if (settings.autoOpen && !opened) {
    await openGame($)
    return
  }
  offered = true
  $.ui.invalidate('ui.render')
}

/**
 * Opens the game in its own window: tells the relay where this turn is first, so the window's
 * first look already has Claude's clock, then tries each launcher until one works.
 */
async function openGame($: EngineInterface): Promise<boolean> {
  offered = false
  $.ui.invalidate('ui.render')
  if (working) relay($, { state: 'working', since: turnStartedAt })
  platform ??= await detectPlatform($)
  if (!profile) profile = await profileDir($, platform)
  for (const argv of launchers(platform, windowUrl(gameUrl, code), profile)) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 10_000 })
      if (r.exitCode === 0) {
        opened = true
        return true
      }
    } catch {
      // That launcher isn't here; try the next.
    }
  }
  return false
}

type Relay = { state: 'working'; since: number } | { state: 'ready'; since: number; workedMs: number }

/** The posts in flight, one after another, so a slow "working" can't land after its "ready". */
let posting: Promise<void> = Promise.resolve()

/**
 * One post to the relay, queued behind the last and never awaited: a fetch has no timeout, and a
 * turn mustn't wait on the game's site. If it fails, the game simply doesn't hear.
 */
function relay($: EngineInterface, body: Relay) {
  posting = posting.then(() => post($, body))
  return posting
}

async function post($: EngineInterface, body: Relay) {
  try {
    await $.http.fetch(relayUrl(gameUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-companion-key': code },
      body: JSON.stringify(body),
    })
  } catch {
    // Offline, or the site is down.
  }
}

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 })
    return r.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
  } catch {
    return 'linux'
  }
}

/** A browser profile of the game's own, so its window is its own and keeps its saves. */
async function profileDir($: EngineInterface, p: Platform): Promise<string> {
  if (p === 'windows') return `${(await $.env.get('LOCALAPPDATA')) ?? 'C:\\Temp'}\\UnderManagement\\window`
  return `${(await $.env.get('HOME')) ?? '/tmp'}/.under-management/window`
}

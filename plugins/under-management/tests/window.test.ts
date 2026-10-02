/**
 * Opening the window, and what the mod tells the game's relay about Claude's turn.
 */
import { expect, test } from 'claude-code/testing'

import { SURFACES, T0, world } from './world'

const GAME = 'https://under-management.vercel.app'
const RELAY = `${GAME}/api/companion`
const CODE = '[0-9A-HJKMNP-TV-Z]{16}'

for (const surface of SURFACES) {
  // Pressing 1 is the one moment the mod starts talking to a server, so check both halves of it.
  test(`${surface}: pressing 1 opens an app window under the session's code and posts "working"`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    const ui = await w.mountBand($, surface)
    await w.clock.advance(20_000)

    await ui.press({ key: 'play' })
    await w.clock.settle()

    const argv = w.opens()[0] ?? []
    expect(w.opens()).toHaveLength(1)
    expect(argv.slice(0, 4)).toEqual(['open', '-na', 'Google Chrome', '--args'])
    const app = argv.find((a) => a.startsWith('--app=')) ?? ''
    expect(app).toMatch(new RegExp(`^--app=${GAME}/companion\\?companion=${CODE}$`))
    expect(argv).toContain('--window-size=960,632')

    // The relay is told where the turn is, under the same code the window carries.
    await w.flush()
    expect(w.posts).toHaveLength(1)
    const post = w.posts[0]
    expect(post?.url).toBe(RELAY)
    expect(post?.method).toBe('POST')
    expect(post?.headers['x-companion-key']).toBe(app.slice(-16))
    expect(post?.body).toEqual({ state: 'working', since: T0 })
    await ui.unmount()
  })

  // The game pauses itself on "ready", so the number it shows must be the time Claude worked.
  test(`${surface}: when the turn ends the mod posts "ready" with the time worked`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    const ui = await w.mountBand($, surface)
    await w.clock.advance(20_000)
    await ui.press({ key: 'play' })
    await w.clock.advance(5_000)

    await w.finish($)

    await w.flush()
    expect(w.posts.map((p) => p.body)).toEqual([
      { state: 'working', since: T0 },
      { state: 'ready', since: T0, workedMs: 25_000 },
    ])
    await w.flush()
    expect(w.posts[1]?.url).toBe(RELAY)
    expect(w.posts[1]?.headers['x-companion-key']).toBe(w.posts[0]?.headers['x-companion-key'])
    await ui.unmount()
  })

  // A subagent finishing mid-turn is not Claude finishing; the game must not pause for it.
  test(`${surface}: a subagent's turn.complete posts nothing`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    const ui = await w.mountBand($, surface)
    await w.clock.advance(20_000)
    await ui.press({ key: 'play' })

    await w.finish($, { agentId: 'sub-1' })
    await w.flush()
    expect(w.posts.map((p) => p.body)).toEqual([{ state: 'working', since: T0 }])

    await w.finish($)
    await w.flush()
    expect(w.posts).toHaveLength(2)
    await ui.unmount()
  })
}

// The privacy promise: until the player opens the window, the mod sends nothing to anyone.
test('before the window is opened nothing is posted, however long the turn', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await w.clock.advance(60_000)
  await w.finish($)
  await $.turn.start({ text: 'two', turnId: 't2' })
  await w.clock.advance(60_000)
  await w.finish($)

  await w.flush()
  expect(w.posts).toEqual([])
  expect(w.runs).toEqual([])
})

// Default: the game is offered, never forced. The strip is up, but no browser is touched.
test('auto-open is off by default: the strip is offered and no window opens', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await w.mountBand($, 'terminal')
  await w.clock.advance(60_000)

  expect(await ui.find({ key: 'play' })).toBeDefined()
  expect(w.runs).toEqual([])
  await w.flush()
  expect(w.posts).toEqual([])
})

// With the setting saved, the player who chose "on its own" gets the window after the delay, not before.
test('with autoOpen saved, the window opens on its own after the delay', async ($, on) => {
  const w = world(on, { store: { settings: { autoOpen: true } } })
  await w.start($)
  await $.turn.start({ text: 'one', turnId: 't1' })
  const ui = await w.mountBand($, 'terminal')

  await w.clock.advance(19_999)
  expect(w.runs, 'a tick before the delay').toEqual([])

  await w.clock.advance(1)
  await w.clock.settle()
  const argv = w.opens()[0] ?? []
  expect(argv.slice(0, 4)).toEqual(['open', '-na', 'Google Chrome', '--args'])
  await w.flush()
  expect(w.posts.map((p) => p.body)).toEqual([{ state: 'working', since: T0 }])
  expect(await ui.find({ key: 'play' }), 'no strip needed once it is open').toBeUndefined()
})

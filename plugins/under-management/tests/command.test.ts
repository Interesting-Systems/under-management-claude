/**
 * /under-management: opening the window by hand, and the three settings.
 */
import { expect, test } from 'claude-code/testing'

import { T0, world } from './world'

test('the command is registered when a session starts', async ($, on) => {
  const w = world(on)
  await w.start($)
  expect(w.registered).toEqual(['under-management'])
})

// Settings outlive the session, so check what is written, and that the running session obeys it.
test('/under-management auto on is saved and applies to the next turn', async ($, on) => {
  const w = world(on)
  await w.start($)

  const answer = await w.run($, 'auto on')
  expect(answer.text).toMatch(/^Saved\./)
  expect(w.saved.get('settings')).toEqual({ autoOpen: true, delaySec: 20, strip: true })

  await $.turn.start({ text: 'one', turnId: 't1' })
  await w.clock.advance(20_000)
  await w.clock.settle()
  expect(w.opens()).toHaveLength(1)
})

// A bad value must say so and leave the saved settings alone.
for (const [args, said] of [
  ['delay 3', /"delay" takes a number of seconds from 5 to 600/],
  ['auto maybe', /"auto" takes on or off/],
] as const) {
  test(`/under-management ${args} is refused with a message and saves nothing`, async ($, on) => {
    const w = world(on)
    await w.start($)
    const answer = await w.run($, args)
    expect(answer.text).toMatch(said)
    expect(w.saved.has('settings')).toBe(false)
  })
}

// Bare, the command is the player's own way in; it works with the strip off and between turns.
test('bare /under-management opens the window, and the next turn is heard', async ($, on) => {
  const w = world(on)
  await w.start($)

  await w.run($)
  const argv = w.opens()[0] ?? []
  expect(argv.slice(0, 4)).toEqual(['open', '-na', 'Google Chrome', '--args'])
  await w.flush()
  expect(w.posts, 'no turn is running, so nothing to say yet').toEqual([])

  await w.clock.advance(7_000)
  await $.turn.start({ text: 'one', turnId: 't1' })
  await w.flush()
  expect(w.posts.map((p) => p.body)).toEqual([{ state: 'working', since: T0 + 7_000 }])
})

// If no browser launches, the player still gets the address, which carries this session's code.
test('when no launcher works the reply gives the address instead', async ($, on) => {
  const w = world(on, { launcherExit: 1 })
  await w.start($)
  const answer = await w.run($)
  expect(answer.text).toMatch(/^No browser window would open\. The game is at https:\/\/under-management\.vercel\.app\/companion\?companion=[0-9A-HJKMNP-TV-Z]{16}$/)
  // Every launcher was tried: four Chromium-family apps, then the default browser.
  expect(w.opens()).toHaveLength(5)
})

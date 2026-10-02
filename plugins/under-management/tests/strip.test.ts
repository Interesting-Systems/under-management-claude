/**
 * The strip above the prompt: when it appears, and when it must not.
 */
import { expect, test } from 'claude-code/testing'

import { SURFACES, world } from './world'

for (const surface of SURFACES) {
  // The promise to the player: Claude has to have been busy a while before the game is offered.
  test(`${surface}: nothing is drawn for 20 s, then the band offers the game on key 1`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    const ui = await w.mountBand($, surface)

    expect(await ui.find({ key: 'play' }), 'at once').toBeUndefined()
    await w.clock.advance(19_999)
    expect(await ui.find({ key: 'play' }), 'a tick before the delay').toBeUndefined()

    await w.clock.advance(1)
    const play = await ui.find({ key: 'play' })
    expect(play?.type).toBe('Button')
    expect(play?.props).toMatchObject({ hotkey: '1', label: 'Play Under Management' })
    await ui.unmount()
  })

  // The band is the engine's to yield: no offer while Claude is idle, or while a survey holds it.
  test(`${surface}: the strip stays out of an idle prompt and out of a survey's way`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    await w.clock.advance(20_000)

    const live = await w.mountBand($, surface)
    expect(await live.find({ key: 'play' }), 'control: working, no survey').toBeDefined()
    await live.unmount()

    const idle = await w.mountBand($, surface, { isWorking: false })
    expect(await idle.find({ key: 'play' }), 'isWorking is false').toBeUndefined()
    await idle.unmount()

    const survey = await w.mountBand($, surface, { hasSurvey: true })
    expect(await survey.find({ key: 'play' }), 'a survey holds the band').toBeUndefined()
    await survey.unmount()
  })

  // The offer belongs to the turn that earned it; the next turn starts the wait over.
  test(`${surface}: the strip goes when the turn ends and does not come back early`, async ($, on) => {
    const w = world(on)
    await w.start($)
    await $.turn.start({ text: 'one', turnId: 't1' })
    const ui = await w.mountBand($, surface)
    await w.clock.advance(20_000)
    expect(await ui.find({ key: 'play' })).toBeDefined()

    await w.finish($)
    expect(await ui.find({ key: 'play' }), 'turn over').toBeUndefined()

    await $.turn.start({ text: 'two', turnId: 't2' })
    await w.clock.advance(19_999)
    expect(await ui.find({ key: 'play' }), 'new turn, clock restarted').toBeUndefined()
    await w.clock.advance(1)
    expect(await ui.find({ key: 'play' })).toBeDefined()
    await ui.unmount()
  })
}

// `claude -p` and the SDK have nobody to play: the mod must not register, draw, open or post.
test('a non-interactive session does nothing on turns', async ($, on) => {
  const w = world(on, { store: { settings: { autoOpen: true } } })
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await $.turn.start({ text: 'summarize', turnId: 't1' })
  const ui = await w.mountBand($, 'terminal')
  await w.clock.advance(60_000)

  expect(await ui.find({ key: 'play' })).toBeUndefined()
  await w.finish($)
  expect(w.registered, 'no command').toEqual([])
  expect(w.runs, 'no browser, even with auto-open saved').toEqual([])
  await w.flush()
  expect(w.posts).toEqual([])
})

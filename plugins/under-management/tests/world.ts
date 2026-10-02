/**
 * What every test here shares: the stubs for everything the mod asks Claude Code for, and a few
 * readers over what the mod did with them. Not a test file (it holds no `test()`), so the runner
 * never picks it up on its own.
 */
import type { On, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

/** The mock clock starts here, so `since` in a post is a number worth checking. */
export const T0 = 1_000_000

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

/** What the engine passes the AbovePrompt hook while Claude works. */
export const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

export type Post = { url: string; method?: string; headers: Record<string, string>; body: unknown }

type Options = {
  /** What the mod's store already holds. */
  store?: Record<string, unknown>
  /** The exit code every `open ...` launcher answers with. */
  launcherExit?: number
}

export function world(on: On, options: Options = {}) {
  const clock: MockClock = mock.clock(on, { now: T0 })
  const saved = new Map<string, unknown>(Object.entries(options.store ?? {}))
  /** Every argv the mod ran. */
  const runs: string[][] = []
  /** Every post to the relay. */
  const posts: Post[] = []
  /** `fetch` and the launcher's name, in the order they happened. */
  const log: string[] = []
  /** The commands the mod registered. */
  const registered: string[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('store.get', (_$, e) => ({ value: saved.get(e.key) }))
  on('store.set', (_$, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  // A Mac with a HOME and no UNDER_MANAGEMENT_URL: the mod's defaults.
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    log.push(e.argv[0] ?? '')
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '' } }
    return { value: { exitCode: options.launcherExit ?? 0, stdout: '', stderr: '' } }
  })
  on('http.fetch', (_$, e) => {
    log.push('fetch')
    posts.push({
      url: e.url,
      method: e.init?.method,
      headers: e.init?.headers ?? {},
      body: JSON.parse(e.init?.body ?? 'null'),
    })
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  // Stands for what Claude Code draws in the band when the mod passes with next(e).
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  return {
    clock,
    saved,
    runs,
    posts,
    log,
    registered,
    /** Lets the mod's queued posts go out: it never awaits them, so a turn can't wait on the site. */
    flush: async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve()
      await clock.settle()
    },
    /** The commands that tried to open a window (everything but the platform check). */
    opens: () => runs.filter((argv) => argv[0] !== 'uname'),
    /** An interactive terminal session starts. */
    start: ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' }),
    /** The AbovePrompt band, drawn for one surface. */
    mountBand: ($: Engine, surface: Surface, props: Partial<RenderPropsOf['AbovePrompt']> = {}) =>
      $.ui.mount({
        plugin: 'under-management',
        surface,
        component: 'AbovePrompt',
        requestId: 'band',
        viewport: { columns: 100, rows: 30 },
        props: { ...BAND, ...props },
      }),
    /** The player types `/under-management <args>`. */
    run: ($: Engine, args = '') =>
      $.command.run({
        command: 'under-management',
        args,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      }),
    /** The main loop's turn ends. */
    finish: ($: Engine, extra: { agentId?: string } = {}) =>
      $.turn.complete({
        turnId: 't1',
        answer: 'Done.',
        durationMs: 0,
        isAborted: false,
        reason: 'answer',
        ...extra,
      }),
  }
}

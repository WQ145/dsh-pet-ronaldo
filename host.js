// =============================================================================
// C罗桌宠 · DSH bundle 插件（Host 半）
// 常驻：作为 profile bundle 加载，跨进程重启保留。
// =============================================================================

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const name = 'ronaldo-pet'

export const inject = ['timer', 'webServer']

const CONFIG = {
  spritePath: join(__dirname, 'assets', 'spritesheet.webp'),
  voicePath: join(__dirname, 'assets', 'siu.mp3'),
  pollMs: 500,
  celebrateMs: 4800,
  failedMs: 2600,
}

// Windows 用 WPF MediaPlayer 播放 mp3；macOS 改 afplay；Linux 改 ffplay
const playCommand = (path) => {
  const p = path.replace(/'/g, "''")
  return "powershell.exe -NoProfile -WindowStyle Hidden -Command \"Add-Type -AssemblyName presentationCore; $m = New-Object System.Windows.Media.MediaPlayer; $m.Open('" + p + "'); $m.Play(); Start-Sleep -Seconds 5; $m.Close()\""
}

export function apply(ctx) {
  const webServer = ctx.webServer

  let spriteBytes = null
  let voiceBytes = null
  let disposed = false
  const routeDisposers = []

  let mode = 'idle'
  let seq = 0
  let celebrating = false
  let celebrateTimer = null
  let failTimer = null
  let toolsInFlight = 0
  let recentTool = false
  let recentToolTimer = null
  let waitingCount = 0

  const turnFlags = new WeakMap()
  const lastStatus = new WeakMap()
  const observedAgents = new Set()

  const flagsOf = (agent) => {
    let f = turnFlags.get(agent)
    if (f === undefined) { f = { worked: false, errored: false }; turnFlags.set(agent, f) }
    return f
  }
  const lastStatusEntries = () => {
    const out = []
    for (const agent of observedAgents) {
      const s = lastStatus.get(agent)
      if (s !== undefined) out.push([agent, s])
    }
    return out
  }
  const currentRunningCount = () => {
    let n = 0
    for (const e of lastStatusEntries()) if (e[1] === 'running') n++
    return n
  }
  const setMode = (next) => {
    if (next === mode) return
    if (celebrating && next !== 'celebrating') return
    mode = next
    seq++
  }
  const deriveMode = (runningCount) => {
    if (celebrating) return
    let next
    if (waitingCount > 0) next = 'waiting'
    else if (runningCount > 0) next = (toolsInFlight > 0 || recentTool) ? 'working' : 'review'
    else next = 'idle'
    setMode(next)
  }

  const playSystemVoice = () => {
    const shell = ctx.get('shell')
    if (shell === undefined) return
    try {
      const sp = ctx.get('sandboxPolicy')
      const sandboxPolicy = sp !== undefined ? sp.resolve({ mode: 'danger-full-access' }) : { mode: 'danger-full-access', workspaceRoot: '' }
      const spec = shell.resolve({ command: playCommand(CONFIG.voicePath), sandboxPolicy })
      shell.run(spec).catch(() => {})
    } catch (err) {
      console.error('[ronaldo-pet] failed to start voice playback:', err)
    }
  }

  const celebrate = () => {
    if (celebrating) {
      if (celebrateTimer) celebrateTimer()
      celebrateTimer = ctx.timeout(() => { celebrateTimer = null; celebrating = false; deriveMode(currentRunningCount()) }, CONFIG.celebrateMs)
      return
    }
    celebrating = true
    setMode('celebrating')
    playSystemVoice()
    celebrateTimer = ctx.timeout(() => { celebrateTimer = null; celebrating = false; deriveMode(currentRunningCount()) }, CONFIG.celebrateMs)
  }

  const showFailed = () => {
    if (celebrating) return
    setMode('failed')
    if (failTimer) failTimer()
    failTimer = ctx.timeout(() => { failTimer = null; deriveMode(currentRunningCount()) }, CONFIG.failedMs)
  }

  const markToolSettled = (wasQuestion) => {
    toolsInFlight = Math.max(0, toolsInFlight - 1)
    if (wasQuestion) waitingCount = Math.max(0, waitingCount - 1)
    if (toolsInFlight === 0) {
      if (recentToolTimer) recentToolTimer()
      recentToolTimer = ctx.timeout(() => { recentToolTimer = null; recentTool = false; deriveMode(currentRunningCount()) }, 2500)
    }
    deriveMode(currentRunningCount())
  }

  routeDisposers.push(webServer.register({
    kind: 'exact',
    path: '/ronaldo-pet/state',
    handler: (req, res) => {
      const body = JSON.stringify({ mode, seq })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-store',
      })
      res.end(body)
    },
  }))

  const registerAssetRoutes = () => {
    if (spriteBytes !== null) {
      routeDisposers.push(webServer.register({
        kind: 'exact',
        path: '/ronaldo-pet/spritesheet.webp',
        handler: (req, res) => {
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': String(spriteBytes.length), 'Cache-Control': 'public, max-age=86400' })
          res.end(spriteBytes)
        },
      }))
    }
    if (voiceBytes !== null) {
      routeDisposers.push(webServer.register({
        kind: 'exact',
        path: '/ronaldo-pet/siu.mp3',
        handler: (req, res) => {
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(voiceBytes.length), 'Cache-Control': 'public, max-age=86400' })
          res.end(voiceBytes)
        },
      }))
    }
  }

  const loadAssets = async () => {
    try {
      spriteBytes = await readFile(CONFIG.spritePath)
      console.log('[ronaldo-pet] spritesheet loaded:', spriteBytes.length, 'bytes')
    } catch (err) {
      console.error('[ronaldo-pet] failed to load spritesheet:', err)
    }
    try {
      voiceBytes = await readFile(CONFIG.voicePath)
      console.log('[ronaldo-pet] voice loaded:', voiceBytes.length, 'bytes')
    } catch (err) {
      console.error('[ronaldo-pet] failed to load voice:', err)
    }
    if (!disposed) registerAssetRoutes()
  }
  loadAssets()

  ctx.effect(() => () => {
    disposed = true
    for (const d of routeDisposers) d()
    if (celebrateTimer) celebrateTimer()
    if (failTimer) failTimer()
    if (recentToolTimer) recentToolTimer()
  })

  const agentsService = ctx.get('agents')
  const poll = () => {
    if (agentsService === undefined) return
    let list
    try { list = agentsService.list() } catch (err) { return }
    if (!Array.isArray(list)) return
    const runningNow = new Set()
    for (const agent of list) {
      let status = 'idle'
      try { status = agent && agent.status === 'running' ? 'running' : 'idle' } catch (err) { status = 'idle' }
      if (status === 'running') runningNow.add(agent)
      const prev = lastStatus.get(agent)
      lastStatus.set(agent, status)
      if (agent && prev === undefined) observedAgents.add(agent)
      if (prev === 'running' && status === 'idle') {
        if (runningNow.size === 0 && waitingCount === 0) {
          const f = turnFlags.get(agent)
          if (f === undefined || !f.errored) celebrate()
          if (f !== undefined) turnFlags.delete(agent)
        }
      }
    }
    deriveMode(runningNow.size)
  }
  const stopPolling = ctx.interval(poll, CONFIG.pollMs)
  ctx.effect(() => stopPolling)

  ctx.on('approval/request', (req, next) => {
    waitingCount++
    deriveMode(currentRunningCount())
    let p
    try { p = Promise.resolve(next()) } catch (err) { waitingCount = Math.max(0, waitingCount - 1); deriveMode(currentRunningCount()); throw err }
    p.then(
      () => { waitingCount = Math.max(0, waitingCount - 1); deriveMode(currentRunningCount()) },
      () => { waitingCount = Math.max(0, waitingCount - 1); deriveMode(currentRunningCount()) },
    )
    return p
  })

  ctx.on('tools/execute', (exec, next) => {
    let isQuestion = false
    if (exec && exec.agent) flagsOf(exec.agent).worked = true
    if (exec && typeof exec.name === 'string' && exec.name === 'ask_user_question') { isQuestion = true; waitingCount++ }
    toolsInFlight++
    recentTool = true
    if (recentToolTimer) { recentToolTimer(); recentToolTimer = null }
    deriveMode(currentRunningCount())
    let p
    try { p = Promise.resolve(next()) } catch (err) { markToolSettled(isQuestion); throw err }
    p.then(
      () => markToolSettled(isQuestion),
      () => markToolSettled(isQuestion),
    )
    return p
  })

  ctx.on('agent/request-error', (payload, next) => {
    if (payload && payload.agent) flagsOf(payload.agent).errored = true
    showFailed()
    return next()
  })
}

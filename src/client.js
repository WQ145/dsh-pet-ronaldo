// =============================================================================
// C罗桌宠 · DSH 动态插件（Client 半）
// 用于 DSH 的 cordis_define 工具：code.client 字段
//
// 职责：
//   1. 注入 shell.overlay 渲染宠物，注入 settings.section 提供统一管理面板
//   2. 通用精灵图渲染：每只宠物自带 sheet（布局）+ states（状态行映射）
//   3. 轮询 pet-state RPC 同步宿主状态机，映射到动画（待机/颠球/思考/等待/摔倒/SIU）
//   4. 支持拖动运球、悬停看向光标、快速连点假摔、点击气泡
//   5. 设置页支持导入自定义 spritesheet（codex 目录 / 手动图片）统一管理
//
// 说明：对话完成的 SIU 声音由 Host 端系统级播放（见 src/host.js），
//       客户端仅负责动画，避免双响。
// =============================================================================

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 内置 C罗：8 列 × 11 行精灵图契约（192×208 每格）
    const CODE_STATES = {
      idle: { row: 0, frames: 6, fps: 6 },
      runRight: { row: 1, frames: 8, fps: 12 },
      runLeft: { row: 2, frames: 8, fps: 12 },
      waving: { row: 3, frames: 4, fps: 8 },
      jumping: { row: 4, frames: 5, fps: 10 },
      failed: { row: 5, frames: 8, fps: 12 },
      waiting: { row: 6, frames: 6, fps: 5 },
      running: { row: 7, frames: 6, fps: 12 },
      review: { row: 8, frames: 6, fps: 6 },
      look: { rows: [9, 10] },
    }
    // 宿主状态模式 → 动画行
    const HOST_ANIM = {
      idle: 'idle',
      working: 'running',
      review: 'review',
      waiting: 'waiting',
      failed: 'failed',
      celebrating: 'jumping',
    }
    const BEHAVIOR_OPTIONS = [
      { value: 'idle', label: '😌 待机' },
      { value: 'waving', label: '👋 挥手' },
      { value: 'running', label: '⚽ 颠球' },
      { value: 'review', label: '🤔 思考' },
    ]
    const PHRASES = ['SIUUUUU! 🎉', '进球啦！⚽', '完美的终结！', 'Vamos!', '这就是 7 号！']
    const DIVE_PHRASES = ['Penalty kick! ⚽', '给我点球！Penalty!', '点球！裁判！']

    let state = {
      pets: [ { id: 'p1', name: 'C罗', size: 120, visible: true, pos: null, behavior: 'idle', sheet: { uri: null, cols: 8, rows: 11, cellW: 192, cellH: 208 }, states: CODE_STATES } ],
      hostMode: 'idle',
    }
    let nextId = 2
    let dragRef = null
    let lastSeq = -1
    const listeners = new Set()

    const getState = () => state
    const subscribe = (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }
    const notify = () => { listeners.forEach((fn) => { try { fn() } catch (e) {} }) }
    const setState = (patch) => { state = Object.assign({}, state, patch); notify() }
    const updatePet = (id, patch) => { state = Object.assign({}, state, { pets: state.pets.map((p) => p.id === id ? Object.assign({}, p, patch) : p) }); notify() }
    const removePet = (id) => { state = Object.assign({}, state, { pets: state.pets.filter((p) => p.id !== id) }); notify() }
    const setAllVisible = (v) => { state = Object.assign({}, state, { pets: state.pets.map((p) => Object.assign({}, p, { visible: v })) }); notify() }
    const addImportedPet = (data) => {
      const n = nextId; nextId += 1
      const pet = { id: 'p' + n, name: (data && data.name) || ('宠物' + n), size: 120, visible: true, pos: null, behavior: 'idle', sheet: (data && data.sheet) || { uri: null, cols: 8, rows: 11, cellW: 192, cellH: 208 }, states: (data && data.states) || {} }
      state = Object.assign({}, state, { pets: state.pets.concat([pet]) })
      notify()
    }

    const useStore = () => {
      const pair = React.useState(0)
      const setTick = pair[1]
      React.useEffect(() => subscribe(() => setTick((t) => t + 1)), [])
      return getState()
    }

    const framePos = (col, row, cols, rows) => (col * 100 / (cols - 1)) + '% ' + (row * 100 / (rows - 1)) + '%'

    function PetSpriteRenderer(props) {
      const pet = props.pet
      const mode = props.mode || 'idle'
      const lookDir = (((props.lookDir || 0) % 16) + 16) % 16
      const size = props.size || pet.size || 120
      const sheet = pet.sheet || {}
      const states = pet.states || {}
      const cols = sheet.cols || 8
      const rows = sheet.rows || 11
      const cellW = sheet.cellW || 192
      const cellH = sheet.cellH || 208
      const uri = sheet.uri
      const pair = React.useState(0)
      const frame = pair[0]
      const setFrame = pair[1]
      React.useEffect(() => {
        if (mode === 'look') { setFrame(0); return undefined }
        const st = states[mode]
        if (!st || !st.frames) { setFrame(0); return undefined }
        setFrame(0)
        let f = 0
        return ctx.interval(() => { f = (f + 1) % st.frames; setFrame(f) }, Math.round(1000 / (st.fps || 8)))
      }, [mode])
      let col
      let row
      if (mode === 'look') {
        const lk = states.look
        if (lk && lk.rows && lk.rows.length >= 2) {
          if (lookDir < 8) { row = lk.rows[0]; col = lookDir } else { row = lk.rows[1]; col = lookDir - 8 }
        } else {
          const st = states.idle || { row: 0 }
          row = st.row; col = 0
        }
      } else {
        const st = states[mode] || states.idle || { row: 0, frames: 1 }
        row = st.row; col = frame % (st.frames || 1)
      }
      const style = { width: size + 'px', height: Math.round(size * cellH / cellW) + 'px', backgroundImage: uri ? 'url(' + uri + ')' : undefined, backgroundSize: (cols * 100) + '% ' + (rows * 100) + '%', backgroundRepeat: 'no-repeat', backgroundPosition: framePos(col, row, cols, rows) }
      return React.createElement('div', { className: 'dp-ronaldo', style: style })
    }

    function PetSprite(props) {
      const pet = props.pet
      const hostMode = props.hostMode
      const h = React.useState(false); const hover = h[0]; const setHover = h[1]
      const l = React.useState(0); const lookDir = l[0]; const setLookDir = l[1]
      const d1 = React.useState(false); const dragging = d1[0]; const setDragging = d1[1]
      const d2 = React.useState('running'); const dragDir = d2[0]; const setDragDir = d2[1]
      const b = React.useState(null); const bubble = b[0]; const setBubble = b[1]
      const dv = React.useState(false); const diving = dv[0]; const setDiving = dv[1]
      const ct = React.useState([]); const clickTimes = ct[0]; const setClickTimes = ct[1]
      React.useEffect(() => { if (bubble === null) return undefined; return ctx.timer.timeout(() => setBubble(null), 2600) }, [bubble])
      React.useEffect(() => { if (!diving) return undefined; return ctx.timer.timeout(() => setDiving(false), 2500) }, [diving])

      const resolveMode = () => {
        if (dragging) return dragDir || 'running'
        if (diving) return 'failed'
        if (hover && pet.states && pet.states.look) return 'look'
        if (hostMode && hostMode !== 'idle') return HOST_ANIM[hostMode] || 'idle'
        return pet.behavior || 'idle'
      }
      const mode = resolveMode()

      const onPointerDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        dragRef = { id: pet.id, startX: e.clientX, startY: e.clientY, originLeft: rect.left, originTop: rect.top, lastDx: 0, moved: false }
        setDragging(true)
        setDragDir('running')
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
      }
      const onPointerMove = (e) => {
        const d = dragRef
        if (d !== null && d.id === pet.id) {
          const left = d.originLeft + (e.clientX - d.startX)
          const top = d.originTop + (e.clientY - d.startY)
          d.lastDx = e.clientX - d.startX
          if (Math.abs(d.lastDx) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true
          if (d.lastDx > 4) setDragDir('runRight')
          else if (d.lastDx < -4) setDragDir('runLeft')
          else setDragDir('running')
          updatePet(pet.id, { pos: { left: Math.round(left), top: Math.round(top) } })
          return
        }
        if (hover) {
          const rect = e.currentTarget.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const dx = e.clientX - cx
          const dy = e.clientY - cy
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            let deg = Math.atan2(dx, -dy) * 180 / Math.PI
            if (deg < 0) deg += 360
            setLookDir(Math.round(deg / 22.5) % 16)
          }
        }
      }
      const onPointerUp = (e) => {
        const d = dragRef
        dragRef = null
        setDragging(false)
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (d === null || !d.moved) {
          const now = Date.now()
          const recent = clickTimes.filter((t) => now - t < 1500)
          recent.push(now)
          setClickTimes(recent)
          if (recent.length >= 3) {
            setClickTimes([])
            setDiving(true)
            setBubble(DIVE_PHRASES[Math.floor(Math.random() * DIVE_PHRASES.length)])
          } else {
            setBubble(PHRASES[Math.floor(Math.random() * PHRASES.length)])
          }
        }
      }
      const onPointerEnter = () => setHover(true)
      const onPointerLeave = () => setHover(false)
      const onPointerCancel = () => { dragRef = null; setDragging(false) }

      const style = { position: 'fixed', left: pet.pos ? pet.pos.left + 'px' : undefined, top: pet.pos ? pet.pos.top + 'px' : undefined, right: pet.pos ? undefined : 24, bottom: pet.pos ? undefined : 16, zIndex: 9991 }
      return React.createElement('div', { className: 'dp-pet', style: style, title: pet.name, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerEnter: onPointerEnter, onPointerLeave: onPointerLeave, onPointerCancel: onPointerCancel },
        bubble !== null ? React.createElement('div', { className: 'dp-bubble', key: 'bubble' }, bubble) : null,
        React.createElement(PetSpriteRenderer, { pet: pet, mode: mode, lookDir: lookDir })
      )
    }

    function Overlay() {
      const st = useStore()
      React.useEffect(() => {
        let alive = true
        const sync = async () => {
          try {
            const s = await host.call('pet-state')
            if (!alive || !s) return
            const seq = typeof s.seq === 'number' ? s.seq : -1
            if (seq !== lastSeq) {
              lastSeq = seq
              setState({ hostMode: String(s.mode || 'idle') })
            }
            if (s.spriteUrl) {
              const p1 = state.pets.find((p) => p.id === 'p1')
              if (p1 && p1.sheet.uri !== s.spriteUrl) updatePet('p1', { sheet: Object.assign({}, p1.sheet, { uri: s.spriteUrl }) })
            }
          } catch (e) { /* transient rpc error */ }
        }
        sync()
        const stop = ctx.interval(sync, 400)
        return () => { alive = false; stop() }
      }, [])
      const visible = st.pets.filter((p) => p.visible)
      return React.createElement('div', { className: 'dp-overlay' },
        visible.map((p) => React.createElement(PetSprite, { key: p.id, pet: p, hostMode: st.hostMode }))
      )
    }

    function ImportPanel() {
      const ds = React.useState(''); const dir = ds[0]; const setDir = ds[1]
      const ips = React.useState(''); const imgPath = ips[0]; const setImgPath = ips[1]
      const cs = React.useState('8'); const cols = cs[0]; const setCols = cs[1]
      const rs = React.useState('11'); const rows = rs[0]; const setRows = rs[1]
      const ws = React.useState('192'); const cellW = ws[0]; const setCellW = ws[1]
      const hs = React.useState('208'); const cellH = hs[0]; const setCellH = hs[1]
      const fs = React.useState(''); const frames = fs[0]; const setFrames = fs[1]
      const ms = React.useState(null); const msg = ms[0]; const setMsg = ms[1]
      const bs = React.useState(false); const busy = bs[0]; const setBusy = bs[1]
      const doCodexImport = () => {
        const d = dir.trim()
        if (!d) { setMsg('请输入 codex 项目目录路径'); return }
        setBusy(true); setMsg('导入中…')
        host.call('import-codex', { dir: d }).then((res) => {
          setBusy(false)
          if (res && res.ok) { addImportedPet(res); setMsg('✅ 导入成功：' + (res.name || '宠物')) }
          else { setMsg('❌ 导入失败：' + (res && res.error ? res.error : '未知错误')) }
        })
      }
      const doImageImport = () => {
        const p = imgPath.trim()
        if (!p) { setMsg('请输入 spritesheet 图片路径'); return }
        const c = parseInt(cols, 10) || 8
        const r = parseInt(rows, 10) || 11
        const cw = parseInt(cellW, 10) || 192
        const ch = parseInt(cellH, 10) || 208
        let fpr = null
        if (frames.trim()) fpr = frames.split(',').map((x) => parseInt(x, 10) || 0)
        setBusy(true); setMsg('导入中…')
        host.call('import-image', { path: p, cols: c, rows: r, cellW: cw, cellH: ch, framesPerRow: fpr }).then((res) => {
          setBusy(false)
          if (res && res.ok) { addImportedPet({ name: '宠物', sheet: res.sheet, states: res.states }); setMsg('✅ 导入成功') }
          else { setMsg('❌ 导入失败：' + (res && res.error ? res.error : '未知错误')) }
        })
      }
      return React.createElement('div', { className: 'dp-import' },
        React.createElement('h3', { className: 'dp-import-title' }, '📥 导入宠物'),
        React.createElement('div', { className: 'dp-import-row' },
          React.createElement('label', { className: 'dp-label' }, '方式一：从 codex 项目目录导入（自动读取 spritesheet + 元数据）'),
          React.createElement('div', { className: 'dp-import-line' },
            React.createElement('input', { className: 'dp-input', value: dir, onChange: (e) => setDir(e.target.value), placeholder: '例如 D:\\代码\\C&\\ronaldo-pet' }),
            React.createElement('button', { type: 'button', className: 'dp-btn dp-btn-primary', onClick: doCodexImport, disabled: busy }, '导入目录')
          )
        ),
        React.createElement('div', { className: 'dp-import-divider' }, '— 或手动指定 spritesheet —'),
        React.createElement('div', { className: 'dp-import-row' },
          React.createElement('label', { className: 'dp-label' }, 'spritesheet 图片路径（本机绝对路径）'),
          React.createElement('input', { className: 'dp-input', value: imgPath, onChange: (e) => setImgPath(e.target.value), placeholder: '例如 D:\\pets\\my-pet.png' })
        ),
        React.createElement('div', { className: 'dp-import-grid' },
          React.createElement('div', { className: 'dp-import-field' }, React.createElement('label', { className: 'dp-label' }, '列数'), React.createElement('input', { className: 'dp-input', value: cols, onChange: (e) => setCols(e.target.value) })),
          React.createElement('div', { className: 'dp-import-field' }, React.createElement('label', { className: 'dp-label' }, '行数'), React.createElement('input', { className: 'dp-input', value: rows, onChange: (e) => setRows(e.target.value) })),
          React.createElement('div', { className: 'dp-import-field' }, React.createElement('label', { className: 'dp-label' }, '格宽 px'), React.createElement('input', { className: 'dp-input', value: cellW, onChange: (e) => setCellW(e.target.value) })),
          React.createElement('div', { className: 'dp-import-field' }, React.createElement('label', { className: 'dp-label' }, '格高 px'), React.createElement('input', { className: 'dp-input', value: cellH, onChange: (e) => setCellH(e.target.value) }))
        ),
        React.createElement('div', { className: 'dp-import-row' },
          React.createElement('label', { className: 'dp-label' }, '每行帧数（可选，逗号分隔，如 6,8,8,4,5,8,6,6,6；留空 = 每行满帧）'),
          React.createElement('input', { className: 'dp-input', value: frames, onChange: (e) => setFrames(e.target.value), placeholder: '留空 = 每行满帧' })
        ),
        React.createElement('div', { className: 'dp-import-line' },
          React.createElement('button', { type: 'button', className: 'dp-btn dp-btn-primary', onClick: doImageImport, disabled: busy }, '导入图片'),
          msg !== null ? React.createElement('span', { className: 'dp-import-msg' }, msg) : null
        ),
        React.createElement('p', { className: 'dp-import-hint' }, '状态按行号约定：0=待机 · 1=右跑 · 2=左跑 · 3=挥手 · 4=跳跃(成功) · 5=摔倒(失败) · 6=等待 · 7=颠球(对话中) · 8=思考 · 9-10=视线(可选)。')
      )
    }

    function PetCard(props) {
      const pet = props.pet
      const info = pet.sheet ? (pet.sheet.cols + '×' + pet.sheet.rows + ' · ' + pet.sheet.cellW + '×' + pet.sheet.cellH + 'px') : ''
      return React.createElement('div', { className: 'dp-card' },
        React.createElement('div', { className: 'dp-card-preview' }, React.createElement(PetSpriteRenderer, { pet: pet, mode: 'idle', size: 60 })),
        React.createElement('div', { className: 'dp-card-body' },
          React.createElement('div', { className: 'dp-row' },
            React.createElement('label', { className: 'dp-label' }, '名字'),
            React.createElement('input', { className: 'dp-input', value: pet.name, onChange: (e) => updatePet(pet.id, { name: e.target.value }), placeholder: '给宠物起个名字' })
          ),
          React.createElement('div', { className: 'dp-row' },
            React.createElement('label', { className: 'dp-label' }, '平时行为'),
            React.createElement('div', { className: 'dp-seg' },
              BEHAVIOR_OPTIONS.map((bb) => React.createElement('button', { key: bb.value, type: 'button', className: 'dp-seg-btn' + (pet.behavior === bb.value ? ' dp-seg-active' : ''), onClick: () => updatePet(pet.id, { behavior: bb.value }) }, bb.label))
            )
          ),
          React.createElement('div', { className: 'dp-row' },
            React.createElement('label', { className: 'dp-label' }, '大小' + (info ? '  ·  布局 ' + info : '')),
            React.createElement('div', { className: 'dp-slider-wrap' },
              React.createElement('input', { type: 'range', min: 60, max: 220, value: pet.size, className: 'dp-slider', onChange: (e) => updatePet(pet.id, { size: Number(e.target.value) }) }),
              React.createElement('span', { className: 'dp-size-val' }, pet.size + 'px')
            )
          ),
          React.createElement('div', { className: 'dp-row dp-row-actions' },
            React.createElement('button', { type: 'button', className: 'dp-btn' + (pet.visible ? '' : ' dp-btn-ghost'), onClick: () => updatePet(pet.id, { visible: !pet.visible }) }, pet.visible ? '👁 显示中' : '🙈 已隐藏'),
            React.createElement('button', { type: 'button', className: 'dp-btn', onClick: () => updatePet(pet.id, { pos: null }) }, '📍 复位'),
            React.createElement('button', { type: 'button', className: 'dp-btn dp-btn-danger', onClick: () => removePet(pet.id) }, '🗑 删除')
          )
        )
      )
    }

    function SettingsPage() {
      const st = useStore()
      const visibleCount = st.pets.filter((p) => p.visible).length
      return React.createElement('div', { className: 'dp-settings' },
        React.createElement('div', { className: 'dp-head' },
          React.createElement('h2', { className: 'dp-title' }, '⚽ C罗桌宠 · 统一管理'),
          React.createElement('p', { className: 'dp-sub' }, '内置葡萄牙 7 号 C罗；支持导入自定义 spritesheet 精灵图（codex 项目一键导入），命名、大小、行为、显隐、位置统一管理。对话中颠球，完成 SIU 庆祝 + 提示音，出错摔倒。')
        ),
        React.createElement(ImportPanel),
        React.createElement('div', { className: 'dp-toolbar' },
          React.createElement('button', { type: 'button', className: 'dp-btn', onClick: () => setAllVisible(true) }, '全部显示'),
          React.createElement('button', { type: 'button', className: 'dp-btn', onClick: () => setAllVisible(false) }, '全部隐藏'),
          React.createElement('span', { className: 'dp-count' }, '共 ' + st.pets.length + ' 只 · 显示 ' + visibleCount + ' 只')
        ),
        React.createElement('div', { className: 'dp-list' },
          st.pets.length === 0 ? React.createElement('div', { className: 'dp-empty' }, '还没有宠物，在上方导入一个吧~') : st.pets.map((p) => React.createElement(PetCard, { key: p.id, pet: p }))
        )
      )
    }

    styles.insert(`.dp-overlay{position:fixed;inset:0;pointer-events:none;z-index:9990}.dp-pet{position:fixed;pointer-events:auto;cursor:grab;user-select:none;-webkit-user-select:none;z-index:9991;display:flex;flex-direction:column;align-items:center;touch-action:none}.dp-pet:active{cursor:grabbing}.dp-ronaldo{display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,.18))}.dp-bubble{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:8px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:12px;padding:6px 12px;font-size:13px;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.14);animation:dp-rise .18s ease-out}.dp-bubble::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--dsw-alias-bg-overlay,#fff)}@keyframes dp-rise{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}.dp-settings{padding:8px 4px 32px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary,#222)}.dp-head{display:flex;flex-direction:column;gap:4px}.dp-title{margin:0;font-size:18px;font-weight:650}.dp-sub{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary,#666);line-height:1.5}.dp-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.dp-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.dp-list{display:flex;flex-direction:column;gap:12px}.dp-empty{padding:40px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#666);border:1px dashed var(--dsw-alias-border-l2,#ccc);border-radius:12px;font-size:13px}.dp-card{display:flex;gap:16px;padding:16px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:12px}.dp-card-preview{display:flex;align-items:center;justify-content:center;min-width:88px;min-height:88px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);border-radius:10px;overflow:hidden}.dp-card-body{flex:1;display:flex;flex-direction:column;gap:12px}.dp-row{display:flex;flex-direction:column;gap:6px}.dp-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.dp-input{padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:var(--dsw-alias-bg-layer-2,#fafafa);color:var(--dsw-alias-label-primary,#222);font-size:13px}.dp-input:focus{outline:2px solid var(--dsw-alias-brand-primary,#4f6ef7);outline-offset:1px;border-color:transparent}.dp-seg{display:flex;flex-wrap:wrap;gap:6px}.dp-seg-btn{padding:6px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);font-size:12px;cursor:pointer}.dp-seg-active{background:var(--dsw-alias-brand-primary,#4f6ef7);border-color:transparent;color:#fff}.dp-slider-wrap{display:flex;align-items:center;gap:10px}.dp-slider{flex:1;accent-color:var(--dsw-alias-brand-primary,#4f6ef7)}.dp-size-val{font-size:12px;color:var(--dsw-alias-label-secondary,#666);min-width:44px;text-align:right}.dp-row-actions{flex-direction:row;flex-wrap:wrap;gap:8px;margin-top:2px}.dp-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);font-size:13px;cursor:pointer;transition:opacity .15s}.dp-btn:hover{opacity:.85}.dp-btn:disabled{opacity:.5;cursor:not-allowed}.dp-btn-primary{background:var(--dsw-alias-brand-primary,#4f6ef7);border-color:transparent;color:#fff}.dp-btn-danger{color:var(--dsw-alias-state-error-primary,#d64545)}.dp-btn-ghost{opacity:.55}.dp-import{display:flex;flex-direction:column;gap:10px;padding:14px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:12px}.dp-import-title{margin:0;font-size:14px;font-weight:650}.dp-import-row{display:flex;flex-direction:column;gap:6px}.dp-import-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.dp-import-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.dp-import-field{display:flex;flex-direction:column;gap:6px}.dp-import-divider{font-size:12px;color:var(--dsw-alias-label-secondary,#666);text-align:center;margin:2px 0}.dp-import-msg{font-size:12px;color:var(--dsw-alias-state-success-primary,#2e9e44)}.dp-import-hint{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary,#666);line-height:1.5}`)

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'ronaldo-pet', order: 30, label: '⚽ 桌宠' },
      () => React.createElement(SettingsPage),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'ronaldo-pet', order: 100 },
      () => React.createElement(Overlay),
    ))
  },
}

// C罗桌宠 · 仓库完整性校验
// 用法：node scripts/validate.mjs
// 检查：素材存在且格式正确、插件源码结构正确、精灵图尺寸符合 8×11 契约
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, msg) => {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg)
  if (!cond) failed++
}

const spritePath = join(root, 'assets', 'spritesheet.webp')
const voicePath = join(root, 'assets', 'siu.mp3')
ok(existsSync(spritePath), 'assets/spritesheet.webp 存在')
ok(existsSync(voicePath), 'assets/siu.mp3 存在')

if (existsSync(spritePath)) {
  const buf = readFileSync(spritePath)
  const isWebp = buf.length > 32 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
  ok(isWebp, 'spritesheet.webp 是合法 WebP（RIFF/WEBP 头）')
  if (isWebp) {
    const vp8x = buf.indexOf(Buffer.from('VP8X'))
    if (vp8x > 0 && buf.length > vp8x + 10) {
      const w = buf.readUIntLE(vp8x + 4, 3) + 1
      const h = buf.readUIntLE(vp8x + 7, 3) + 1
      ok(w === 1536 && h === 2288, `spritesheet.webp 尺寸为 1536×2288（实测 ${w}×${h}，契约要求 8 列 × 11 行、每格 192×208）`)
    }
  }
}
if (existsSync(voicePath)) {
  const buf = readFileSync(voicePath)
  const isMp3 = buf.length > 3 && (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
  ok(isMp3, 'siu.mp3 是合法 MP3（ID3/MPEG 头）')
  ok(buf.length > 8 * 1024, `siu.mp3 大小合理（${buf.length} bytes）`)
}

for (const [name, mustContain] of [
  ['src/host.js', ['inject:', 'apply(ctx)', 'pet-state', 'import-codex', 'import-image', 'agentsService', 'webServer']],
  ['src/client.js', ['inject:', 'apply(ctx)', 'shell.overlay', 'settings.section', 'CODE_STATES', 'PetSpriteRenderer', 'ImportPanel']],
  ['host.js', ['export const name', 'export function apply', 'webServer', '/ronaldo-pet/state']],
  ['client/client.js', ['__ModuleLoader__', 'shell.overlay', 'ronaldo-pet']],
]) {
  const p = join(root, name)
  ok(existsSync(p), `${name} 存在`)
  if (existsSync(p)) {
    const src = readFileSync(p, 'utf-8')
    for (const token of mustContain) ok(src.includes(token), `${name} 包含关键片段 ${token}`)
  }
}

console.log(failed === 0 ? '\n✅ 校验通过' : `\n❌ ${failed} 项校验失败`)
process.exit(failed === 0 ? 0 : 1)

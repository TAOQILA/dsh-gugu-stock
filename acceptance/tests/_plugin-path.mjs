// 测试可以在两种目录布局下运行：
//   1) 仓库根：<repo>/dsh-gugu-stock（插件）+ <repo>/acceptance/tests（测试）
//   2) 插件根：<plugin>/acceptance/tests（发布到 GitHub 的仓库就是这个形状，CI 用它）
// 这里统一算出插件目录，避免每个测试各写一份相对路径。
import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const SIBLING = path.resolve(HERE, '..', '..', 'dsh-gugu-stock')
const SELF = path.resolve(HERE, '..', '..')

const isPluginDir = (dir) =>
  fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'index.js'))

// 两种布局都指向同一个插件时（插件目录名叫 dsh-gugu-stock 且测试在它下面），自我布局优先。
export const PLUGIN = isPluginDir(SELF) ? SELF : SIBLING
export const ROOT = path.dirname(PLUGIN)
export const hasPlugin = isPluginDir(PLUGIN)

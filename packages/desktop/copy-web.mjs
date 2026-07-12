// Copies the built web app into dist/web so electron-builder's `files`
// globs pick it up (it only packs from within this package).
import { cpSync, rmSync } from 'node:fs'

rmSync('dist/web', { recursive: true, force: true })
cpSync('../web/dist', 'dist/web', { recursive: true })
console.log('copied ../web/dist -> dist/web')

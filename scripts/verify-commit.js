import { readFileSync } from 'node:fs'
import path from 'node:path'

const msgPath = path.resolve('.git/COMMIT_EDITMSG')
const msg = readFileSync(msgPath, 'utf-8').trim()

const commitRE
  = /^(?:revert: )?(?:feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release)(?:\(.+\))?: .{1,72}/

if (!commitRE.test(msg)) {
  console.log()
  console.error(
    `  ERROR  invalid commit message format.\n\n`
    + `  Proper commit message format is required for automated changelog generation. Examples:\n\n`
    + `    feat(compiler): add 'comments' option\n`
    + `    fix(renderer): handle events on blur (close #28)\n\n`
    + `  See .github/commit-convention.md for more details.`,
  )
  process.exit(1)
}

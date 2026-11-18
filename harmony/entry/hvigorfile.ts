import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hapTasks } from '@ohos/hvigor-ohos-plugin';

// DevEco 直接运行时也先构建、同步前端，避免打包旧 rawfile。
execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-harmony.mjs'), '--prepare'], {
  cwd: path.resolve(__dirname, '../..'),
  stdio: 'inherit'
});

// 模块级 hvigor 构建脚本（HAP）
export default {
  system: hapTasks,
  plugins: []
};

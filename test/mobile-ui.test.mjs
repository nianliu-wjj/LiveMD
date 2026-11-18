import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("移动端通过 isMobile 关闭应用内更新入口", () => {
  const service = read("src/service/api/update.ts");
  assert.match(service, /if \(window\.electronAPI\?\.isMobile\) return null;/, "更新服务应短路");

  const menuBar = read("src/components/menu/MenuBar.vue");
  assert.match(menuBar, /if \(!isMobile\) \{\s*checkUpdate\(\)/, "设置面板自动检查应门控");
  assert.match(menuBar, /const isMobile = window\.electronAPI\.isMobile;/, "应读取移动端标记");

  const about = read("src/components/settings/About.vue");
  assert.match(about, /if \(isMobile\) return;/, "关于页手动检查应门控");
  assert.match(about, /!isMobile && storedUpdateInfo\.version/, "移动端不显示 new 徽标");
  assert.match(about, /v-if="!isMobile && isChecking"/, "移动端不显示检查中状态");

  const statusBar = read("src/components/menu/StatusBar.vue");
  assert.match(
    statusBar,
    /v-if="!isMobile && updateStatus === 'downloading'/,
    "状态栏隐藏下载进度"
  );
  assert.match(
    statusBar,
    /v-else-if="!isMobile && updateStatus === 'downloaded'/,
    "状态栏隐藏安装入口"
  );

  const app = read("src/App.vue");
  assert.match(app, /if \(isMobile\) return;/, "更新事件回调应门控");
  assert.match(
    app,
    /if \(!isMobile\) \{\s*window\.electronAPI\.on\("update:available"/,
    "主进程更新事件应门控"
  );
  assert.match(app, /<UpdateConfirmDialog\s+v-if="!isMobile"/, "移动端不渲染更新弹窗");
});

test("触屏/窄屏布局覆盖菜单、状态栏、标题栏与设置页", () => {
  const responsive = read("src/styles/responsive.less");
  assert.match(responsive, /--titlebar-height: 44px;/, "移动端标题栏变量应加高");
  assert.match(responsive, /--statusbar-height: 44px;/, "移动端状态栏变量应加高");
  assert.match(responsive, /touch-action: manipulation;/, "触屏控件应禁用双击缩放");
  assert.match(responsive, /\.SettingBaseBox input/, "设置页输入框应适配移动端字号");

  const menuBar = read("src/components/menu/MenuBar.vue");
  assert.match(menuBar, /@media \(max-width: 640px\)/, "设置页应有窄屏布局");
  assert.match(menuBar, /flex-direction: row;/, "设置导航应改为顶部横向标签");

  const statusBar = read("src/components/menu/StatusBar.vue");
  assert.match(statusBar, /min-width: 40px;/, "状态栏按钮触屏目标应加大");
  assert.match(statusBar, /\.stats-popup \{[\s\S]*position: fixed;/, "统计弹层在手机上应贴底展示");

  const titleBar = read("src/components/menu/TitleBar.vue");
  assert.match(titleBar, /height: var\(--titlebar-height, 40px\);/, "标题栏高度应跟随变量");

  const tabBar = read("src/components/workspace/TabBar.vue");
  assert.match(tabBar, /min-width: 28px;/, "标签关闭按钮触屏目标应加大");
});

test("项目菜单支持无 hover 的触屏操作与就地二级菜单", () => {
  const menu = read("src/components/menu/MenuDropDown.vue");
  assert.match(menu, /handleSubmenuTap/, "二级菜单应支持点击切换");
  assert.match(menu, /@click\.stop="handleSubmenuTap\('recent'\)"/, "最近文件应可点击展开");
  assert.match(menu, /@click\.stop="handleSubmenuTap\('export'\)"/, "导出菜单应可点击展开");
  assert.match(menu, /@click\.stop="handleSubmenuTap\('theme'\)"/, "主题菜单应可点击展开");
  assert.match(menu, /position: static;/, "手机端二级菜单应就地展开");
  assert.match(menu, /min-height: 46px;/, "手机端菜单项应满足点按尺寸");
});

test("主对话框在手机上改为全宽底部面板", () => {
  for (const path of [
    "src/components/dialogs/SaveConfirmDialog.vue",
    "src/components/dialogs/UpdateConfirmDialog.vue",
  ]) {
    const dialog = read(path);
    assert.match(dialog, /@media \(max-width: 640px\)/, `${path} 应有窄屏样式`);
    assert.match(dialog, /max-height: calc\(100dvh - 24px\)/, `${path} 应限制面板高度`);
    assert.match(dialog, /\.btn \{[\s\S]*min-height: 44px;/, `${path} 按钮应满足触屏尺寸`);
  }

  const reload = read("src/components/dialogs/ReloadConfirmDialog.vue");
  assert.match(reload, /flex-direction: column-reverse;/, "重启确认按钮应纵向铺满");

  const link = read("src/components/dialogs/InsertLinkDialog.vue");
  assert.match(link, /height: 44px;/, "插入链接输入框应适配触屏");
});

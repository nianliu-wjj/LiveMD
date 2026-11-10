<script setup lang="ts">
/**
 * 搜索与替换（对应参考项目 Search.vue，基于引擎 Search 插件）
 *
 * - 打开：总线 show_search（底部栏派发）或快捷键 Ctrl+F（注册到引擎 keyCommand，与参考项目一致）；打开时收起右侧面板；
 * - 回车搜索 / 跳到下一个，结果列表点击定位；替换当前、全部替换（只读时禁用）；
 * - 监听总线 search_info_change（当前序号 / 总数）、node_click / draw_click / expand_btn_click（让输入框失焦）、
 *   setData（导入新数据时关闭搜索）；直接监听引擎 search_match_node_list_change（匹配列表）。
 * - 输入框聚焦时临时关闭引擎「键盘输入时自动进入文本编辑」，失焦时恢复。
 * 与参考项目的差异：
 * - 失焦时恢复聚焦前的取值（参考项目固定恢复为 true，会覆盖「设置」面板里关闭的选项）；
 * - 结果高亮按纯文本逐段渲染，不用 v-html（避免节点文本注入 HTML、搜索词含正则字符时报错）；
 * - 点击结果后同步「当前序号」（插件 jump 不派发 search_info_change）；
 * - 搜索框内 Esc 关闭搜索、Ctrl+F 选中搜索词；结果列表高度按编辑器根元素计算。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import autotoast from "autotoast.js";
import { useBusEvent, useMindMapContext } from "../context";
import { getEditorRootSize, getNodeText, splitByKeyword, type HighlightSegment } from "./helpers";
import NavIcon from "./NavIcon.vue";

interface SearchResultItem {
  id: string;
  name: string;
  segments: HighlightSegment[];
}

const { mindMap, bus, isReadonly, setActiveSidebar } = useMindMapContext();
/** 引擎实例（卸载时根组件可能已把 mindMap 置空，解绑要用挂载时的实例） */
const instance = mindMap.value;

const searchInputRef = ref<HTMLInputElement | null>(null);
const replaceInputRef = ref<HTMLInputElement | null>(null);
const show = ref(false);
const searchText = ref("");
const replaceText = ref("");
const showReplaceInput = ref(false);
/** 当前定位到第几个（从 1 开始） */
const currentIndex = ref(0);
const total = ref(0);
const showSearchInfo = ref(false);
const searchResultListHeight = ref(0);
const searchResultList = ref<SearchResultItem[]>([]);
const showSearchResultList = ref(false);
/** 本次结果列表对应的搜索词（高亮用，与引擎匹配用的文本一致） */
let resultKeyword = "";
/** 输入框聚焦前「键盘输入时自动进入文本编辑」的取值，失焦时恢复 */
let savedAutoEnterTextEdit: unknown;
let hasSavedAutoEnterTextEdit = false;

/** 与引擎 isUndef 一致：null / undefined / 空串视为空 */
function isUndef(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

watch(searchText, (value) => {
  if (isUndef(value)) {
    currentIndex.value = 0;
    total.value = 0;
    showSearchInfo.value = false;
  }
});

function handleSearchInfoChange(data: { currentIndex: number; total: number }): void {
  currentIndex.value = data.currentIndex + 1;
  total.value = data.total;
  showSearchInfo.value = true;
}

/**
 * 聚焦输入框并可选全选：必须 preventScroll——滑入动画开始时输入框还在根元素右侧外面，
 * 普通 focus 会把 overflow: hidden 的编辑器根元素横向滚动，画布与所有浮层整体错位
 */
function focusInput(input: HTMLInputElement | null, selectAll = false): void {
  if (!input) return;
  input.focus({ preventScroll: true });
  if (selectAll) input.select();
}

/** 打开搜索并聚焦输入框 */
function showSearch(): void {
  bus.emit("closeSideBar");
  setActiveSidebar("");
  show.value = true;
  console.info("[MindMap/Search] 打开搜索");
  // 隐藏态带 visibility: hidden 不能聚焦，等样式更新后再聚焦
  void nextTick(() => focusInput(searchInputRef.value, true));
}

function hideReplaceInput(): void {
  showReplaceInput.value = false;
  replaceText.value = "";
}

function openReplaceInput(): void {
  showReplaceInput.value = true;
  void nextTick(() => focusInput(replaceInputRef.value));
}

/** 输入框聚焦时，禁止节点响应按键自动进入文本编辑 */
function onFocus(): void {
  const current = mindMap.value;
  if (!current) return;
  if (!hasSavedAutoEnterTextEdit) {
    savedAutoEnterTextEdit = current.opt.enableAutoEnterTextEditWhenKeydown;
    hasSavedAutoEnterTextEdit = true;
  }
  current.updateConfig({ enableAutoEnterTextEditWhenKeydown: false });
}

/** 输入框失焦时恢复 */
function onBlur(): void {
  const current = mindMap.value;
  if (!current || !hasSavedAutoEnterTextEdit) return;
  current.updateConfig({ enableAutoEnterTextEditWhenKeydown: savedAutoEnterTextEdit });
  hasSavedAutoEnterTextEdit = false;
}

/** 画布、节点点击时让输入框失焦 */
function blur(): void {
  searchInputRef.value?.blur();
  replaceInputRef.value?.blur();
}

/** 回车：搜索或跳到下一个匹配节点 */
function onSearchNext(): void {
  const search = mindMap.value?.search;
  if (!search) return;
  showSearchResultList.value = true;
  console.debug("[MindMap/Search] 搜索:", searchText.value);
  search.search(searchText.value);
}

/**
 * 执行替换：引擎插件用搜索词直接构造正则（未转义），搜索词含 ( [ 等字符时会抛 SyntaxError，
 * 这里兜住异常并提示，避免点击按钮时出现未捕获错误
 */
function runReplace(label: string, action: () => void): void {
  if (isReadonly.value) return;
  console.info(`[MindMap/Search] ${label}`);
  try {
    action();
  } catch (error) {
    console.error(`[MindMap/Search] ${label}失败:`, error);
    autotoast.show("替换失败：搜索内容包含正则表达式特殊字符", "error");
  }
}

function replace(): void {
  runReplace("替换当前匹配", () => mindMap.value?.search?.replace(replaceText.value, true));
}

function replaceAll(): void {
  runReplace("全部替换", () => mindMap.value?.search?.replaceAll(replaceText.value));
}

/** 关闭搜索并清空状态 */
function close(): void {
  show.value = false;
  showSearchResultList.value = false;
  showSearchInfo.value = false;
  total.value = 0;
  currentIndex.value = 0;
  searchText.value = "";
  searchResultList.value = [];
  hideReplaceInput();
  blur();
  mindMap.value?.search?.endSearch();
}

/** 匹配节点列表变化：生成结果列表（节点实例或原始节点数据两种形态） */
function onSearchMatchNodeListChange(list: any[]): void {
  resultKeyword = mindMap.value?.search?.searchText || searchText.value;
  searchResultList.value = (list ?? []).map((item) => {
    const data = item?.data || item?.nodeData?.data || {};
    const name = getNodeText(data);
    return {
      id: String(data.uid ?? ""),
      name,
      segments: splitByKeyword(name, resultKeyword),
    };
  });
}

/** 结果列表高度：编辑器高度减去搜索框上方与自身占用的空间（与参考项目的 267 + 24 一致） */
function setSearchResultListHeight(): void {
  searchResultListHeight.value = Math.max(120, getEditorRootSize(instance?.el).height - 267 - 24);
}

function onSearchResultItemClick(index: number): void {
  const search = mindMap.value?.search;
  if (!search) return;
  search.jump(index);
  // 插件的 jump 不派发 search_info_change，序号会停在旧值（参考项目同样如此），这里同步一次
  search.emitEvent?.();
}

/** 搜索框内的按键：Esc 关闭，Ctrl+F 重新选中搜索词（其余按键不冒泡，避免触发引擎快捷键） */
function onKeydown(e: KeyboardEvent): void {
  e.stopPropagation();
  if (e.key === "Escape") {
    close();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    focusInput(searchInputRef.value, true);
  }
}

useBusEvent("show_search", showSearch);
useBusEvent("search_info_change", handleSearchInfoChange);
useBusEvent("node_click", blur);
useBusEvent("draw_click", blur);
useBusEvent("expand_btn_click", blur);
useBusEvent("setData", close);

instance?.on("search_match_node_list_change", onSearchMatchNodeListChange);
instance?.keyCommand.addShortcut("Control+f", showSearch);

onMounted(() => {
  setSearchResultListHeight();
  window.addEventListener("resize", setSearchResultListHeight);
});

onBeforeUnmount(() => {
  instance?.off("search_match_node_list_change", onSearchMatchNodeListChange);
  instance?.keyCommand.removeShortcut("Control+f", showSearch);
  window.removeEventListener("resize", setSearchResultListHeight);
});
</script>

<template>
  <div class="mm-search" :class="{ 'is-show': show }" @keydown="onKeydown">
    <div class="mm-search__close" role="button" title="关闭" @click="close">
      <NavIcon name="close" />
    </div>
    <div class="mm-search__input-box">
      <div class="mm-search__field">
        <span class="mm-search__prefix"><NavIcon name="search" /></span>
        <input
          ref="searchInputRef"
          v-model="searchText"
          class="mm-search__input"
          type="text"
          placeholder="输入查找内容后按回车键"
          @keyup.enter.stop="onSearchNext"
          @focus="onFocus"
          @blur="onBlur"
        />
        <span v-if="showSearchInfo && !isUndef(searchText)" class="mm-search__info">
          {{ currentIndex }} / {{ total }}
        </span>
        <button
          v-if="!isUndef(searchText)"
          type="button"
          class="mm-search__append"
          @click="openReplaceInput"
        >
          替换
        </button>
      </div>
    </div>
    <div v-if="showReplaceInput" class="mm-search__field mm-search__replace">
      <span class="mm-search__prefix"><NavIcon name="edit" /></span>
      <input
        ref="replaceInputRef"
        v-model="replaceText"
        class="mm-search__input"
        type="text"
        placeholder="请输入替换内容"
        @focus="onFocus"
        @blur="onBlur"
      />
      <button type="button" class="mm-search__append" @click="hideReplaceInput">取消</button>
    </div>
    <div v-if="showReplaceInput" class="mm-search__btns">
      <button type="button" class="mm-btn mm-btn--small" :disabled="isReadonly" @click="replace">
        替换
      </button>
      <button type="button" class="mm-btn mm-btn--small" :disabled="isReadonly" @click="replaceAll">
        全部替换
      </button>
    </div>
    <div
      v-if="showSearchResultList"
      class="mm-search__result"
      :style="{ height: searchResultListHeight + 'px' }"
    >
      <div
        v-for="(item, index) in searchResultList"
        :key="`${item.id}-${index}`"
        class="mm-search__result-item"
        :title="item.name"
        @click.stop="onSearchResultItemClick(index)"
      >
        <template v-for="(segment, segmentIndex) in item.segments" :key="segmentIndex">
          <span v-if="segment.match" class="mm-search__match">{{ segment.text }}</span>
          <template v-else>{{ segment.text }}</template>
        </template>
      </div>
      <div v-if="searchResultList.length <= 0" class="mm-search__empty">
        <span class="mm-iconfont iconwushuju" />
        <span class="mm-search__empty-text">暂无结果</span>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.mm-search {
  position: absolute;
  top: 110px;
  right: 20px;
  z-index: 1100;
  width: 296px;
  padding: 16px;
  border-radius: 12px;
  background-color: var(--background-color-1, #fff);
  color: var(--text-color, #333);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.1);
  /* 收起时移到右侧外面（根元素 overflow: hidden），与参考项目从右侧滑入的效果一致；
     visibility 隐藏时延迟到滑出结束再生效，显示时立即生效（否则过渡首帧仍不可见，打开后无法立即聚焦输入框） */
  transform: translateX(calc(100% + 40px));
  visibility: hidden;
  transition:
    transform 0.3s,
    visibility 0s linear 0.3s;

  &.is-show {
    transform: none;
    visibility: visible;
    transition:
      transform 0.3s,
      visibility 0s;
  }
}

.mm-search__close {
  position: absolute;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--background-color-1, #fff);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.1);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

.mm-search__input-box {
  position: relative;
}

.mm-search__field {
  display: flex;
  align-items: center;
  height: 32px;
  border: 1px solid var(--border-color-1, #dcdfe6);
  border-radius: 4px;
  background: var(--background-color-1, #fff);
  overflow: hidden;

  &:focus-within {
    border-color: var(--primary-color, #409eff);
  }
}

.mm-search__prefix {
  display: inline-flex;
  align-items: center;
  padding: 0 6px 0 10px;
  font-size: 14px;
  color: var(--text-color-3, #c0c4cc);
}

.mm-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 6px 0 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  user-select: text;
}

.mm-search__info {
  flex-shrink: 0;
  padding: 0 8px;
  font-size: 13px;
  color: var(--text-color-3, #909090);
}

.mm-search__append {
  flex-shrink: 0;
  height: 100%;
  padding: 0 12px;
  border: none;
  border-left: 1px solid var(--border-color-1, #dcdfe6);
  background: var(--background-color-2, #f5f7fa);
  color: var(--text-color-2, #606266);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

.mm-search__replace {
  margin: 12px 0;
}

.mm-search__btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.mm-search__result {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  margin-top: 5px;
  padding: 12px 0;
  overflow-y: auto;
  border-radius: 12px;
  background-color: var(--background-color-1, #fff);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.1);
}

.mm-search__result-item {
  position: relative;
  height: 30px;
  padding: 0 12px 0 22px;
  overflow: hidden;
  font-size: 14px;
  line-height: 30px;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 10px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background-color: var(--text-color-2, #606266);
    transform: translateY(-50%);
  }

  &:hover {
    background-color: var(--hover-background-color, #f2f4f7);
  }
}

.mm-search__match {
  color: var(--primary-color, #409eff);
  font-weight: bold;
}

.mm-search__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;

  .mm-iconfont {
    margin-bottom: 20px;
    font-size: 50px;
    color: var(--text-color-3, #c0c4cc);
  }
}

.mm-search__empty-text {
  font-size: 14px;
  color: var(--text-color-2, rgba(26, 26, 26, 0.8));
}
</style>

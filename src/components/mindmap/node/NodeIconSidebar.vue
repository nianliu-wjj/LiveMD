<script setup lang="ts">
/**
 * 节点图标 / 贴纸侧边栏（移植自参考项目 NodeIconSidebar.vue，面板名 nodeIconSidebar）
 *
 * - 「图标」页签：内置图标 + 扩展图标（同类型合并），点击时逐个节点按「已有删除 / 同类替换 / 否则追加」切换；
 * - 「贴纸」页签：首次切到该页签才用 loadStickerGroups() 加载图片库（替代参考项目 config/image.js）。
 *   与参考项目不同：贴纸以 data URL 嵌入节点（地址随应用版本变化，直接存地址会导致 Markdown 换环境后失效），
 *   回显选中态时按内容比对；
 * - 只有一个激活节点时回显其图标与图片，多选时不回显（与参考项目一致）。
 * 打开方式：工具栏「图标」按钮 bus.emit('close_node_icon_toolbar') + setActiveSidebar('nodeIconSidebar')。
 */
import { reactive, ref, shallowRef, watch } from "vue";
import autotoast from "autotoast.js";
import type { MindMapNodeInstance } from "@/core/mindmap-engine/full";
import { useBusEvent, useMindMapContext } from "../context";
import { loadStickerGroups, type StickerGroup, type StickerItem } from "../config";
import MmPanel from "../ui/MmPanel.vue";
import NodeIconGrid from "./NodeIconGrid.vue";
import { getNodeIconGroups, stickerToDataUrl, toggleNodeIcon } from "./nodeContentUtils";

const PANEL_NAME = "nodeIconSidebar";

const { activeNodes, activeSidebar, isReadonly } = useMindMapContext();

const iconGroups = getNodeIconGroups();
const activeTab = ref<"icon" | "image">("icon");
/** 单个激活节点的图标（回显） */
const iconList = ref<string[]>([]);
/** 单个激活节点图片的真实地址（回显选中的贴纸；NodeBase64ImageStorage 下数据里存的是 key） */
const nodeImage = ref("");
let nodes: MindMapNodeInstance[] = [...activeNodes.value];

/** 贴纸库加载状态 */
const stickerStatus = ref<"idle" | "loading" | "loaded" | "error">("idle");
const stickerGroups = shallowRef<StickerGroup[]>([]);
/** 贴纸原地址 → data URL（已转换过的），用于按内容回显选中态 */
const stickerDataUrls = reactive(new Map<string, string>());
/** 正在转换并设置的贴纸（防止连续点击） */
const applyingSticker = ref("");
let resolveAllStickersTask: Promise<void> | null = null;

/** 从激活节点回显（对应参考项目 handleNodeActive） */
function syncFromNodes(): void {
  if (nodes.length === 1) {
    const node = nodes[0];
    nodeImage.value = node.getImageUrl?.() || "";
    iconList.value = [...(node.getData("icon") ?? [])];
  } else {
    nodeImage.value = "";
    iconList.value = [];
  }
}

syncFromNodes();

useBusEvent("node_active", (_node: unknown, list: MindMapNodeInstance[] = []) => {
  nodes = [...list];
  syncFromNodes();
});

// 面板打开期间节点数据可能被其它入口修改（图标浮动工具条、撤销 / 重做），保持回显同步
useBusEvent("data_change", () => {
  if (activeSidebar.value === PANEL_NAME) syncFromNodes();
});

watch(activeSidebar, (name) => {
  if (name === PANEL_NAME) syncFromNodes();
});

/** 只读或未选节点时给出提示，返回是否可以修改 */
function canModify(): boolean {
  if (isReadonly.value) {
    autotoast.show("只读模式下无法修改节点", "info");
    return false;
  }
  if (nodes.length <= 0) {
    autotoast.show("请先选择节点", "info");
    return false;
  }
  return true;
}

/** 设置图标：每个节点按自身图标列表切换（对应参考项目 setIcon） */
function setIcon(type: string, name: string): void {
  if (!canModify()) return;
  const single = nodes.length === 1;
  nodes.forEach((node) => {
    const next = toggleNodeIcon(node.getData("icon") ?? [], type, name);
    node.setIcon(next);
    if (single) iconList.value = next;
  });
  console.debug("[MindMap/NodeIconSidebar] 设置图标:", `${type}_${name}`, "节点数:", nodes.length);
}

/* ------------------------------ 贴纸 ------------------------------ */

/** 首次切到「贴纸」页签时加载图片库（结果由 config/image 缓存） */
async function loadStickers(): Promise<void> {
  if (stickerStatus.value === "loading" || stickerStatus.value === "loaded") return;
  stickerStatus.value = "loading";
  try {
    stickerGroups.value = await loadStickerGroups();
    stickerStatus.value = "loaded";
    console.info("[MindMap/NodeIconSidebar] 贴纸库已加载，分组数:", stickerGroups.value.length);
    ensureStickerMatched();
  } catch (error) {
    stickerStatus.value = "error";
    console.error("[MindMap/NodeIconSidebar] 贴纸库加载失败:", error);
  }
}

function isStickerSelected(item: StickerItem): boolean {
  const image = nodeImage.value;
  if (!image) return false;
  return item.url === image || stickerDataUrls.get(item.url) === image;
}

/**
 * 回显选中的贴纸：节点里存的是贴纸的 data URL，只能按内容比对。
 * 仅当节点图片是 SVG data URL 且尚未匹配到时，才把全部贴纸转换一次（本地资源，结果缓存）。
 */
function ensureStickerMatched(): void {
  if (activeTab.value !== "image" || stickerStatus.value !== "loaded") return;
  if (!nodeImage.value.startsWith("data:image/svg+xml")) return;
  const items = stickerGroups.value.flatMap((group) => group.list);
  if (items.some(isStickerSelected) || resolveAllStickersTask) return;
  console.debug("[MindMap/NodeIconSidebar] 转换全部贴纸以回显选中态，数量:", items.length);
  resolveAllStickersTask = Promise.allSettled(
    items.map(async (item) => {
      stickerDataUrls.set(item.url, await stickerToDataUrl(item.url));
    })
  ).then(() => undefined);
}

watch(activeTab, (tab) => {
  if (tab !== "image") return;
  if (stickerStatus.value === "loaded") ensureStickerMatched();
  else void loadStickers();
});
watch(nodeImage, ensureStickerMatched);

/** 设置贴纸（对应参考项目 setImage）：转成 data URL 后设置到全部激活节点 */
async function setImage(item: StickerItem): Promise<void> {
  if (applyingSticker.value || !canModify()) return;
  const targets = [...nodes];
  applyingSticker.value = item.url;
  try {
    const url = await stickerToDataUrl(item.url);
    stickerDataUrls.set(item.url, url);
    targets.forEach((node) => {
      node.setImage({ url, title: "", width: item.width, height: item.height });
    });
    nodeImage.value = url;
    console.info("[MindMap/NodeIconSidebar] 已设置贴纸，节点数:", targets.length);
  } catch (error) {
    console.error("[MindMap/NodeIconSidebar] 设置贴纸失败:", error);
    autotoast.show("贴纸加载失败，请重试", "error");
  } finally {
    applyingSticker.value = "";
  }
}
</script>

<template>
  <MmPanel name="nodeIconSidebar" title="图标/贴纸">
    <div class="node-icon-sidebar">
      <div class="node-icon-sidebar__tabs" role="tablist">
        <span
          class="node-icon-sidebar__tab"
          :class="{ 'is-active': activeTab === 'icon' }"
          role="tab"
          :aria-selected="activeTab === 'icon'"
          @click="activeTab = 'icon'"
        >
          图标
        </span>
        <span
          class="node-icon-sidebar__tab"
          :class="{ 'is-active': activeTab === 'image' }"
          role="tab"
          :aria-selected="activeTab === 'image'"
          @click="activeTab = 'image'"
        >
          贴纸
        </span>
      </div>

      <!-- 图标 -->
      <div v-if="activeTab === 'icon'">
        <div v-for="group in iconGroups" :key="group.type" class="node-icon-sidebar__group">
          <div class="node-icon-sidebar__title">{{ group.name }}</div>
          <NodeIconGrid
            :type="group.type"
            :list="group.list"
            :selected="iconList"
            @select="(name: string) => setIcon(group.type, name)"
          />
        </div>
      </div>

      <!-- 贴纸 -->
      <div v-else>
        <div v-if="stickerStatus === 'loading'" class="node-icon-sidebar__status">贴纸加载中…</div>
        <div v-else-if="stickerStatus === 'error'" class="node-icon-sidebar__status">
          贴纸加载失败
          <button type="button" class="mm-btn mm-btn--small" @click="loadStickers">重试</button>
        </div>
        <div v-for="group in stickerGroups" :key="group.name" class="node-icon-sidebar__group">
          <div class="node-icon-sidebar__title">{{ group.name }}</div>
          <div class="node-icon-sidebar__stickers">
            <span
              v-for="item in group.list"
              :key="item.url"
              class="node-icon-sidebar__sticker"
              :class="{
                'is-selected': isStickerSelected(item),
                'is-applying': applyingSticker === item.url,
              }"
              @click="setImage(item)"
            >
              <img :src="item.url" alt="" loading="lazy" draggable="false" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.node-icon-sidebar__tabs {
  display: flex;
  gap: 20px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border-color-1, #e4e7ed);
}

.node-icon-sidebar__tab {
  margin-bottom: -1px;
  padding: 6px 2px 8px;
  border-bottom: 2px solid transparent;
  color: var(--text-color-2, #666);
  cursor: pointer;
  user-select: none;

  &:hover {
    color: var(--primary-color, #409eff);
  }

  &.is-active {
    border-bottom-color: var(--primary-color, #409eff);
    color: var(--primary-color, #409eff);
    font-weight: 600;
  }
}

.node-icon-sidebar__group {
  margin-bottom: 20px;
}

.node-icon-sidebar__title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.node-icon-sidebar__status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--text-color-3, #999);
}

.node-icon-sidebar__stickers {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.node-icon-sidebar__sticker {
  position: relative;
  width: 50px;
  height: 50px;
  cursor: pointer;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  &.is-selected::after {
    content: "";
    position: absolute;
    inset: -4px;
    box-sizing: border-box;
    border: 2px solid var(--primary-color, #409eff);
    pointer-events: none;
  }

  &.is-applying {
    opacity: 0.5;
    cursor: progress;
  }
}
</style>

<script setup lang="ts">
/**
 * 结构面板（对应参考项目 Structure.vue），面板名 structure
 *
 * 按 layoutGroupList 分组显示结构预览图（layoutImgMap），点击后 setLayout 并 notifyChange
 * （对应参考项目 storeData({ layout })）。打开面板时读取当前结构；在参考项目基础上补充监听
 * layout_change，导入数据等途径改变结构时高亮同步。
 */
import { computed, ref, watch } from "vue";
import MmPanel from "../ui/MmPanel.vue";
import { useBusEvent, useMindMapContext } from "../context";
import { layoutGroupList, layoutImgMap } from "../config";

/** 参考项目在结构面板中隐藏的结构 */
const HIDDEN_LAYOUTS = ["rightFishbone", "rightFishbone2"];

const { mindMap, activeSidebar, notifyChange } = useMindMapContext();

const imgMap = layoutImgMap as Record<string, string>;
/** 当前结构（高亮用） */
const layout = ref(mindMap.value?.getLayout() ?? "");

const groupList = computed(() =>
  layoutGroupList.map((group) => ({
    name: group.name,
    list: group.list.filter((item) => !HIDDEN_LAYOUTS.includes(item)),
  }))
);

/** 切换结构（对应参考项目 useLayout） */
function applyLayout(value: string): void {
  const instance = mindMap.value;
  if (!instance) return;
  console.info("[MindMap/Structure] 切换结构:", value);
  layout.value = value;
  instance.setLayout(value);
  notifyChange();
}

watch(activeSidebar, (value) => {
  if (value === "structure" && mindMap.value) layout.value = mindMap.value.getLayout();
});

useBusEvent("layout_change", (value: string) => {
  layout.value = value;
});
</script>

<template>
  <MmPanel name="structure" title="结构">
    <div class="mm-structure">
      <div v-for="group in groupList" :key="group.name" class="mm-structure__group">
        <div class="mm-structure__name">{{ group.name }}</div>
        <div class="mm-structure__list">
          <div
            v-for="item in group.list"
            :key="item"
            class="mm-structure__item"
            :class="{ 'is-active': item === layout }"
            @click="applyLayout(item)"
          >
            <img :src="imgMap[item]" alt="" draggable="false" />
          </div>
        </div>
      </div>
    </div>
  </MmPanel>
</template>

<style lang="less" scoped>
.mm-structure__group {
  margin-bottom: 12px;
}

.mm-structure__name {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #303133);
}

.mm-structure__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.mm-structure__item {
  box-sizing: border-box;
  height: 76px;
  padding: 5px;
  border: 1px solid var(--border-color-1, #e9e9e9);
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  transition:
    box-shadow 0.2s,
    border-color 0.2s;

  &:hover {
    box-shadow:
      0 1px 2px -2px rgba(0, 0, 0, 0.16),
      0 3px 6px 0 rgba(0, 0, 0, 0.12),
      0 5px 12px 4px rgba(0, 0, 0, 0.09);
  }

  &.is-active {
    border-color: var(--primary-color, #409eff);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>

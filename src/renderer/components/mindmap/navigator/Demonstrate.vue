<script setup lang="ts">
/**
 * 底部栏演示模式（对应参考项目 Demonstrate.vue）
 *
 * 点击后调用引擎 Demonstrate 插件进入演示：插件会让画布容器 mindMap.el 全屏并逐个高亮节点。
 * 全屏时只有 mindMap.el 内的元素可见，所以「退出」按钮与步骤条用 Teleport 放进 mindMap.el
 * （参考项目在 nextTick 里 appendChild 到 #mindMapContainer，效果相同）。
 *
 * 监听总线 demonstrate_jump(index, total)、exit_demonstrate（根组件转发的引擎事件）。
 * 与参考项目的差异：浏览器拒绝全屏时（fullscreenerror）复位界面并解绑插件的全屏监听，
 * 避免插件停在「未进入却以为在演示」的状态；未进入演示时点「退出」只复位界面。
 */
import { onBeforeUnmount, ref } from "vue";
import autotoast from "autotoast.js";
import { useBusEvent, useMindMapContext } from "../context";
import NavIcon from "./NavIcon.vue";

const { mindMap } = useMindMapContext();

/** 引擎容器（Teleport 目标；setup 时引擎已就绪） */
const mindMapEl = mindMap.value?.el ?? null;

/** 是否已点击进入演示（显示退出按钮与步骤条） */
const isEnterDemonstrate = ref(false);
/** 当前步骤索引（从 0 开始） */
const curStepIndex = ref(0);
/** 总步骤数 */
const totalStep = ref(0);
/** 跳转输入框 */
const inputStep = ref("");

function enterDemoMode(): void {
  const demonstrate = mindMap.value?.demonstrate;
  if (!demonstrate) {
    console.warn("[MindMap/Demonstrate] 未注册演示插件");
    return;
  }
  isEnterDemonstrate.value = true;
  console.info("[MindMap/Demonstrate] 进入演示模式");
  demonstrate.enter();
}

function exit(): void {
  const demonstrate = mindMap.value?.demonstrate;
  if (demonstrate?.isInDemonstrate) {
    // 插件退出后会派发 exit_demonstrate，由 onExit 复位界面
    demonstrate.exit();
  } else {
    // 尚未真正进入（例如还没完成全屏）：插件 exit 依赖进入时保存的数据，不能调用，只复位界面
    demonstrate?.unBindEvent?.();
    onExit();
  }
}

function onExit(): void {
  isEnterDemonstrate.value = false;
  curStepIndex.value = 0;
  totalStep.value = 0;
  inputStep.value = "";
  console.info("[MindMap/Demonstrate] 已退出演示模式");
}

function onJump(index: number, total: number): void {
  curStepIndex.value = index;
  totalStep.value = total;
}

function prev(): void {
  mindMap.value?.demonstrate?.prev();
}

function next(): void {
  mindMap.value?.demonstrate?.next();
}

/** 输入步骤号回车跳转 */
function onEnter(): void {
  const num = Number(inputStep.value);
  if (Number.isNaN(num)) {
    inputStep.value = "";
  } else if (num >= 1 && num <= totalStep.value) {
    mindMap.value?.demonstrate?.jump(num - 1);
  }
}

/** 浏览器拒绝全屏：演示无法开始，复位界面 */
function onFullscreenError(): void {
  if (!isEnterDemonstrate.value || mindMap.value?.demonstrate?.isInDemonstrate) return;
  console.warn("[MindMap/Demonstrate] 无法进入全屏，演示模式已取消");
  autotoast.show("无法进入全屏，演示模式已取消", "error");
  exit();
}

useBusEvent("demonstrate_jump", onJump);
useBusEvent("exit_demonstrate", onExit);

document.addEventListener("fullscreenerror", onFullscreenError);
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenerror", onFullscreenError);
});
</script>

<template>
  <div class="mm-demonstrate">
    <span
      class="mm-demonstrate__btn mm-iconfont iconyanshibofang"
      role="button"
      title="进入演示模式"
      @click="enterDemoMode"
    />
    <Teleport v-if="isEnterDemonstrate && mindMapEl" :to="mindMapEl">
      <div
        class="mm-demonstrate-exit"
        title="退出演示"
        @click="exit"
        @mousedown.stop
        @mousemove.stop
        @mouseup.stop
        @wheel.stop
      >
        <span class="mm-iconfont iconguanbi" />
      </div>
      <div class="mm-demonstrate-steps" @mousedown.stop @mousemove.stop @mouseup.stop @wheel.stop>
        <div
          class="mm-demonstrate-steps__jump"
          :class="{ 'is-disabled': curStepIndex <= 0 }"
          title="上一步"
          @click="prev"
        >
          <NavIcon name="back" />
        </div>
        <div class="mm-demonstrate-steps__step">{{ curStepIndex + 1 }} / {{ totalStep }}</div>
        <div
          class="mm-demonstrate-steps__jump"
          :class="{ 'is-disabled': curStepIndex >= totalStep - 1 }"
          title="下一步"
          @click="next"
        >
          <NavIcon name="right" />
        </div>
        <div class="mm-demonstrate-steps__input">
          <input v-model="inputStep" type="text" @keyup.enter.stop="onEnter" @keydown.stop />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.mm-demonstrate {
  display: flex;
  align-items: center;
}

.mm-demonstrate__btn {
  font-size: 24px;
  cursor: pointer;

  &:hover {
    color: var(--primary-color, #409eff);
  }
}

/* 以下元素在演示遮罩（插件高亮层 z-index 10000）之上，固定用白色系 */
.mm-demonstrate-exit {
  position: absolute;
  top: 20px;
  right: 40px;
  z-index: 10001;
  cursor: pointer;
  /* 插件演示时给画布容器加了 pointer-events: none，这里恢复 */
  pointer-events: all;

  .mm-iconfont {
    font-size: 28px;
    color: #fff;
  }
}

.mm-demonstrate-steps {
  position: absolute;
  right: 40px;
  bottom: 20px;
  z-index: 10001;
  display: flex;
  align-items: center;
  pointer-events: all;
  font-size: 14px;
}

.mm-demonstrate-steps__step {
  margin: 0 12px;
  color: #fff;
}

.mm-demonstrate-steps__jump {
  display: inline-flex;
  align-items: center;
  font-size: 16px;
  color: #fff;
  cursor: pointer;

  &.is-disabled {
    color: #999;
    cursor: not-allowed;
  }
}

.mm-demonstrate-steps__input {
  display: flex;
  align-items: center;
  margin-left: 12px;

  input {
    width: 50px;
    height: 30px;
    padding: 0;
    border: 1px solid #999;
    outline: none;
    background-color: transparent;
    color: #fff;
    text-align: center;
  }
}
</style>

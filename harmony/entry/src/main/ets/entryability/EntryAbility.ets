import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

/**
 * 应用入口 Ability：加载 Index 页面（内嵌 Web 承载 web 构建产物）
 */
export default class EntryAbility extends UIAbility {
  onCreate(): void {
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        return;
      }
    });
  }

  onWindowStageDestroy(): void {
  }

  onForeground(): void {
  }

  onBackground(): void {
  }
}

// 通过兼容层调用 Tauri 侧的更新命令
export async function checkUpdate() {
  // 移动端没有应用内更新通道（Android 资产选择分支不命中），直接跳过，
  // 避免调用后只拿到 not-available 却触发“已是最新版本”等误导提示。
  if (window.electronAPI?.isMobile) return null;

  const result = await window.electronAPI.checkForUpdates();
  // result.updateInfo 包含版本信息
  if (result && result.updateInfo) {
    return {
      version: result.updateInfo.version,
      url: result.updateInfo.url, // 自定义下载逻辑需要 URL（或者主进程自己管理，但这里回传也没事）
      notes: result.updateInfo.notes || "",
      releasePageUrl: result.updateInfo.releasePageUrl || "",
      date: result.updateInfo.date,
    };
  }
  return null;
}

export async function downloadUpdate() {
  return await window.electronAPI.downloadUpdate();
}

export async function cancelUpdate() {
  return await window.electronAPI.cancelUpdate();
}

export async function quitAndInstall() {
  return await window.electronAPI.quitAndInstall();
}

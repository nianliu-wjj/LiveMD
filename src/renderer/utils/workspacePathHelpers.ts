/**
 * 路径工具（渲染层）：文件夹名 / 文件名 / 拼接 / 相对工作区
 *
 * 为什么单独成模块：文件树右键「复制文档路径」需要三种路径形态，
 * 项目头部菜单「移动到…」「打开最近文件」也要按文件所在目录切工作区，
 * 这些是纯字符串逻辑，集中一处便于单测（见 test/workspace-path-helpers.test.mjs）。
 */

/** 统一分隔符为 /（内部计算用，展示时按原样拼接） */
function normalize(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

/** 取目录部分（无分隔符时返回空串；根路径返回原样） */
export function dirnameOfPath(pathValue: string): string {
  const normalized = normalize(pathValue).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : index === 0 ? "/" : "";
}

/** 取文件名（含后缀） */
export function fileNameOfPath(pathValue: string): string {
  const normalized = normalize(pathValue).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/** 取不含后缀的文件名 */
export function fileStemOfPath(pathValue: string): string {
  const name = fileNameOfPath(pathValue);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 取后缀（含点；无后缀返回空串） */
export function fileExtensionOfPath(pathValue: string): string {
  const name = fileNameOfPath(pathValue);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** 拼接路径（保留 Windows 的反斜杠风格） */
export function joinPathOf(dirPath: string, name: string): string {
  if (!dirPath) return name;
  const separator = dirPath.includes("\\") ? "\\" : "/";
  const trimmed = dirPath.replace(/[/\\]+$/, "");
  return `${trimmed}${separator}${name}`;
}

/**
 * 计算 filePath 相对 workspaceDir 的路径
 *
 * 不在工作区内（或工作区为空）时返回 null，调用方据此给出提示而不是给出错误路径。
 */
export function relativeToWorkspace(filePath: string, workspaceDir: string): string | null {
  if (!filePath || !workspaceDir) return null;

  const normalizedFile = normalize(filePath);
  const normalizedDir = normalize(workspaceDir).replace(/\/+$/, "");
  const isWindowsPath = /^[a-zA-Z]:/.test(normalizedFile);
  const compare = (value: string) => (isWindowsPath ? value.toLowerCase() : value);

  const file = compare(normalizedFile);
  const dir = compare(normalizedDir);
  if (file === dir) return null;
  if (!file.startsWith(dir.endsWith("/") ? dir : `${dir}/`)) return null;

  return normalizedFile.slice(dir.length + 1);
}

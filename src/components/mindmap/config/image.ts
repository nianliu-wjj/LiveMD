/**
 * 思维导图节点「贴纸」图片库（对应参考项目 web/src/config/image.js）
 *
 * 图片按需加载：import.meta.glob 不使用 eager，只有打开「图标 → 贴纸」页签时才解析各图片地址，
 * 避免 200 多张 SVG 进入编辑器首屏包。
 */

export interface StickerItem {
  url: string;
  width: number;
  height: number;
}

export interface StickerGroup {
  name: string;
  list: StickerItem[];
}

/** 目录名 → 分组名（顺序与参考项目一致） */
const STICKER_GROUPS: ReadonlyArray<{ dir: string; name: string }> = [
  { dir: "business", name: "商务" },
  { dir: "education", name: "教育" },
  { dir: "festival", name: "节日" },
  { dir: "food", name: "食物" },
  { dir: "medicine", name: "医疗" },
  { dir: "tools", name: "工具" },
  { dir: "travel", name: "旅行" },
];

const stickerLoaders = import.meta.glob<string>("../assets/stickers/*/*.svg", {
  query: "?url",
  import: "default",
});

let cache: Promise<StickerGroup[]> | null = null;

/** 加载全部贴纸分组（结果缓存，重复调用不重复解析） */
export function loadStickerGroups(): Promise<StickerGroup[]> {
  cache ??= Promise.all(
    STICKER_GROUPS.map(async ({ dir, name }) => {
      const paths = Object.keys(stickerLoaders)
        .filter((path) => path.includes(`/stickers/${dir}/`))
        .sort();
      const urls = await Promise.all(paths.map((path) => stickerLoaders[path]()));
      return { name, list: urls.map((url) => ({ url, width: 100, height: 100 })) };
    })
  ).catch((error) => {
    cache = null;
    throw error;
  });
  return cache;
}

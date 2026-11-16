/**
 * 粘贴其它思维导图软件的数据（对应参考项目 web/src/utils/handleClipboardText.js）
 *
 * 引擎的 customHandleClipboardText 钩子：剪贴板文本是「知犀」思维导图的节点数据时，
 * 转换为 simple-mind-map 节点数据（文本 / 超链接 / 备注 / 图片 / 概要），粘贴为节点而不是纯文本。
 * 返回空字符串表示不处理，交给引擎默认逻辑。
 */
import { imgToDataUrl } from "@/core/mindmap-engine/src/utils/index.js";

/** 知犀剪贴板数据格式 2 的标记前缀（参考项目以该不可见字符串识别） */
const ZHIXI_MARKER = "\uFFFF\uFEFF";

interface ZhixiNode {
  data: {
    text?: string;
    hyperlink?: string;
    hyperlinkTitle?: string;
    note?: string;
    image?: string;
    imageSize?: unknown;
    type?: string;
  };
  children?: ZhixiNode[];
}

interface ConvertedNode {
  data: Record<string, unknown>;
  children: ConvertedNode[];
}

/** 知犀节点数据 → simple-mind-map 节点数据（图片转为 data URL，保证离线可用） */
async function handleZhixi(raw: unknown): Promise<{ simpleMindMap: true; data: ConvertedNode[] } | ""> {
  try {
    let list = raw;
    if (!Array.isArray(list)) {
      try {
        list = JSON.parse(String(list).replace(ZHIXI_MARKER, ""));
      } catch (error) {
        console.warn("[MindMap/clipboard] 知犀数据解析失败:", error);
      }
    }
    if (!Array.isArray(list)) list = [];

    const pendingImages: Promise<void>[] = [];
    const walk = (source: ZhixiNode[], target: ConvertedNode[]) => {
      for (const item of source) {
        const node: ConvertedNode = {
          data: {
            text: item.data.text,
            hyperlink: item.data.hyperlink,
            hyperlinkTitle: item.data.hyperlinkTitle,
            note: item.data.note,
          },
          children: [],
        };
        target.push(node);
        if (item.data.image) {
          pendingImages.push(
            imgToDataUrl(item.data.image)
              .then((url: string) => {
                node.data.image = url;
                node.data.imageSize = item.data.imageSize;
              })
              .catch((error: unknown) => console.warn("[MindMap/clipboard] 图片转换失败:", error))
          );
        }
        // 概要节点转为父节点的 generalization，其余作为子节点
        const children: ZhixiNode[] = [];
        for (const child of item.children ?? []) {
          if (child.data.type === "generalize") {
            node.data.generalization = [{ text: child.data.text }];
          } else {
            children.push(child);
          }
        }
        walk(children, node.children);
      }
    };
    const result: ConvertedNode[] = [];
    walk(list as ZhixiNode[], result);
    await Promise.all(pendingImages);
    console.info("[MindMap/clipboard] 已转换知犀节点:", result.length);
    return { simpleMindMap: true, data: result };
  } catch (error) {
    console.error("[MindMap/clipboard] 知犀数据转换失败:", error);
    return "";
  }
}

/** 引擎 customHandleClipboardText 钩子 */
export default async function handleClipboardText(text: string) {
  // 知犀数据格式 1：JSON 对象带 __c_zx_v 版本字段
  try {
    const parsed = JSON.parse(text) as { __c_zx_v?: unknown; children?: unknown };
    if (parsed.__c_zx_v !== undefined) return await handleZhixi(parsed.children);
  } catch {
    // 不是 JSON，继续判断其它格式
  }
  // 知犀数据格式 2：带不可见标记的文本
  if (text.includes(ZHIXI_MARKER)) return await handleZhixi(text);
  return "";
}

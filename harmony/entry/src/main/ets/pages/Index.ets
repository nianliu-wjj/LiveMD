import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { webview } from '@kit.ArkWeb';
import { util } from '@kit.ArkTS';

/** 应用文档库中的文档元信息（与前端 MobileDocumentInfo 对齐） */
interface MobileDocumentInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

interface BridgePayload {
  ok: boolean;
  error?: string;
}

interface ListPayload extends BridgePayload {
  documents?: MobileDocumentInfo[];
}

interface ReadPayload extends BridgePayload {
  found?: boolean;
  content?: string;
}

interface SavePayload extends BridgePayload {
  document?: MobileDocumentInfo;
}

interface DeletePayload extends BridgePayload {
  deleted?: number;
}

/**
 * 注入到 ArkWeb 的文档桥：保存模型与 Android 端一致，
 * 文档统一落在应用沙箱 filesDir/documents，以文件名作为标识。
 */
class MobileDocsBridge {
  private dir: string;

  constructor(filesDir: string) {
    this.dir = `${filesDir}/documents`;
  }

  private ensureDir(): void {
    if (!fs.accessSync(this.dir)) {
      fs.mkdirSync(this.dir, true);
    }
    const stat: fs.Stat = fs.lstatSync(this.dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('应用文档目录不是普通目录');
    }
  }

  private sanitize(raw: string): string {
    const trimmed: string = raw.trim();
    if (trimmed.length === 0) {
      throw new Error('文件名不能为空');
    }
    const slash: number = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    const base: string = (slash >= 0 ? trimmed.substring(slash + 1) : trimmed).trim();
    let cleaned: string = '';
    for (let index = 0; index < base.length; index += 1) {
      const ch: string = base.charAt(index);
      const code: number = ch.charCodeAt(0);
      if (code < 32 || (code >= 127 && code <= 159) ||
        ch === '<' || ch === '>' || ch === ':' || ch === '"' ||
        ch === '|' || ch === '?' || ch === '*') {
        cleaned += '_';
      } else {
        cleaned += ch;
      }
    }
    cleaned = cleaned.trim();
    while (cleaned.endsWith('.') || cleaned.endsWith(' ')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
      throw new Error('文件名无效');
    }
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(cleaned)) {
      cleaned = '_' + cleaned;
    }
    const lower: string = cleaned.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.markdown') ? cleaned : `${cleaned}.md`;
  }

  private info(name: string): MobileDocumentInfo {
    const path: string = `${this.dir}/${name}`;
    const stat: fs.Stat = fs.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('文档不是普通文件');
    }
    return {
      name: name,
      size: stat.size,
      modifiedAt: Math.floor(stat.mtime * 1000)
    };
  }

  private documentPath(name: string): string {
    const path: string = this.dir + '/' + name;
    if (fs.accessSync(path)) {
      const stat: fs.Stat = fs.lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('文档不是普通文件');
      }
    }
    return path;
  }

  listDocuments(): string {
    try {
      this.ensureDir();
      const names: string[] = fs.listFileSync(this.dir);
      const documents: MobileDocumentInfo[] = [];
      for (const name of names) {
        const lower: string = name.toLowerCase();
        if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) {
          continue;
        }
        const stat: fs.Stat = fs.lstatSync(this.dir + '/' + name);
        if (!stat.isFile() || stat.isSymbolicLink() || this.sanitize(name) !== name) {
          continue;
        }
        documents.push(this.info(name));
      }
      documents.sort((a: MobileDocumentInfo, b: MobileDocumentInfo) => b.modifiedAt - a.modifiedAt);
      const payload: ListPayload = { ok: true, documents: documents };
      return JSON.stringify(payload);
    } catch (error) {
      const payload: ListPayload = { ok: false, error: (error as Error).message };
      return JSON.stringify(payload);
    }
  }

  readDocument(name: string): string {
    try {
      this.ensureDir();
      const safeName: string = this.sanitize(name);
      const path: string = this.documentPath(safeName);
      if (!fs.accessSync(path)) {
        const payload: ReadPayload = { ok: true, found: false };
        return JSON.stringify(payload);
      }
      const content: string = fs.readTextSync(path, { encoding: 'utf-8' });
      const payload: ReadPayload = { ok: true, found: true, content: content };
      return JSON.stringify(payload);
    } catch (error) {
      const payload: ReadPayload = { ok: false, error: (error as Error).message };
      return JSON.stringify(payload);
    }
  }

  saveDocument(name: string, content: string): string {
    let temporary: string = '';
    let temporaryCreated: boolean = false;
    try {
      this.ensureDir();
      const safeName: string = this.sanitize(name);
      const path: string = this.documentPath(safeName);
      temporary = this.dir + '/.livemd-' + util.generateRandomUUID() + '.tmp';
      if (fs.accessSync(temporary)) {
        throw new Error('保存临时文件已存在，请重试');
      }
      const file: fs.File = fs.openSync(
        temporary,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.NOFOLLOW
      );
      temporaryCreated = true;
      try {
        const bytes: Uint8Array = new util.TextEncoder().encodeInto(content);
        let offset: number = 0;
        while (offset < bytes.byteLength) {
          const buffer: ArrayBuffer = new ArrayBuffer(bytes.byteLength - offset);
          new Uint8Array(buffer).set(bytes.subarray(offset));
          const written: number = fs.writeSync(file.fd, buffer);
          if (written <= 0) {
            throw new Error('文档写入不完整');
          }
          offset += written;
        }
        fs.fsyncSync(file.fd);
      } finally {
        fs.closeSync(file);
      }
      // 同目录原子替换；写入失败时保留已有文档。
      fs.renameSync(temporary, path);
      temporary = '';
      const payload: SavePayload = { ok: true, document: this.info(safeName) };
      return JSON.stringify(payload);
    } catch (error) {
      if (temporaryCreated && temporary.length > 0) {
        try {
          if (fs.accessSync(temporary)) fs.unlinkSync(temporary);
        } catch (cleanupError) {
          // 保存错误仍返回给前端；临时文件不参与文档列表。
        }
      }
      const payload: SavePayload = { ok: false, error: (error as Error).message };
      return JSON.stringify(payload);
    }
  }

  deleteDocuments(namesJson: string): string {
    try {
      this.ensureDir();
      const names: string[] = JSON.parse(namesJson) as string[];
      if (!Array.isArray(names)) {
        throw new Error('文档列表无效');
      }
      const paths: Set<string> = new Set<string>();
      for (const name of names) {
        if (typeof name !== 'string') throw new Error('文件名无效');
        paths.add(this.documentPath(this.sanitize(name)));
      }
      let deleted: number = 0;
      for (const path of paths) {
        if (fs.accessSync(path)) {
          fs.unlinkSync(path);
          deleted += 1;
        }
      }
      const payload: DeletePayload = { ok: true, deleted: deleted };
      return JSON.stringify(payload);
    } catch (error) {
      const payload: DeletePayload = { ok: false, error: (error as Error).message };
      return JSON.stringify(payload);
    }
  }
}

/**
 * LiveMD 主页面：ArkWeb 承载 web 构建产物（entry/src/main/resources/rawfile/www）
 *
 * 加载模型：虚拟主机 https://livemd.local/ → onInterceptRequest 全量拦截，
 * 按 URL 路径从 rawfile 的 www/ 目录回源（静态资源 + SPA 回落 index.html）。
 * web 构建产物 base 为 ./（vite.config.mts），无论相对/绝对路径均可命中拦截。
 */

const LOCAL_ORIGIN: string = 'https://livemd.local/';

function guessMime(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html';
  }
  if (path.endsWith('.js') || path.endsWith('.mjs')) {
    return 'text/javascript';
  }
  if (path.endsWith('.css')) {
    return 'text/css';
  }
  if (path.endsWith('.json') || path.endsWith('.map')) {
    return 'application/json';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (path.endsWith('.gif')) {
    return 'image/gif';
  }
  if (path.endsWith('.webp')) {
    return 'image/webp';
  }
  if (path.endsWith('.ico')) {
    return 'image/x-icon';
  }
  if (path.endsWith('.woff')) {
    return 'font/woff';
  }
  if (path.endsWith('.woff2')) {
    return 'font/woff2';
  }
  if (path.endsWith('.ttf')) {
    return 'font/ttf';
  }
  if (path.endsWith('.otf')) {
    return 'font/otf';
  }
  if (path.endsWith('.wasm')) {
    return 'application/wasm';
  }
  return 'application/octet-stream';
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  docsBridge: MobileDocsBridge = new MobileDocsBridge(getContext(this).filesDir);

  /** 从 rawfile 回源一段内容；命中失败返回 null（交由上层回落） */
  private serveRawfile(path: string): WebResourceResponse | null {
    try {
      // resourceManager 的同步读 rawfile 接口（异步版 getRawFileContent 返回 Promise，无法在拦截器内同步使用）
      const content: Uint8Array = getContext(this).resourceManager.getRawFileContentSync(`www/${path}`);
      const buffer: ArrayBuffer = new ArrayBuffer(content.byteLength);
      const view: Uint8Array = new Uint8Array(buffer);
      view.set(content);
      const response: WebResourceResponse = new WebResourceResponse();
      response.setResponseData(buffer);
      response.setResponseEncoding('utf-8');
      response.setResponseMimeType(guessMime(path));
      response.setResponseCode(200);
      response.setReasonMessage('OK');
      return response;
    } catch (e) {
      return null;
    }
  }

  build() {
    Column() {
      Web({ src: LOCAL_ORIGIN, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .onlineImageAccess(true)
        .zoomAccess(false)
        .multiWindowAccess(false)
        .javaScriptProxy({
          object: this.docsBridge,
          name: 'harmonyBridge',
          methodList: ['listDocuments', 'readDocument', 'saveDocument', 'deleteDocuments'],
          controller: this.controller
        })
        .onLoadIntercept((event) => {
          // 原生文档桥只向应用页面开放，禁止外站在同一 WebView 中加载。
          return !event.data.getRequestUrl().startsWith(LOCAL_ORIGIN);
        })
        .onShowFileSelector((event) => {
          if (!event) return false;
          const options = new picker.DocumentSelectOptions();
          options.maxSelectNumber = 1;
          const selector = new picker.DocumentViewPicker(getContext(this));
          selector.select(options).then((uris: Array<string>) => {
            event.result.handleFileList(uris);
          }).catch(() => {
            event.result.handleFileList([]);
          });
          return true;
        })
        .onInterceptRequest((event) => {
          if (!event) {
            return null;
          }
          const url: string = event.request.getRequestUrl();
          if (!url.startsWith(LOCAL_ORIGIN)) {
            return null;
          }
          let path: string = url.substring(LOCAL_ORIGIN.length);
          const hashIndex: number = path.indexOf('#');
          if (hashIndex >= 0) {
            path = path.substring(0, hashIndex);
          }
          const queryIndex: number = path.indexOf('?');
          if (queryIndex >= 0) {
            path = path.substring(0, queryIndex);
          }
          if (path === '' || path.endsWith('/')) {
            path += 'index.html';
          }
          const direct: WebResourceResponse | null = this.serveRawfile(path);
          if (direct !== null) {
            return direct;
          }
          // SPA 回落：未命中的路径返回入口页（应用为单页编辑器，路由由前端自管）
          if (path !== 'index.html') {
            return this.serveRawfile('index.html');
          }
          return null;
        })
    }
    .width('100%')
    .height('100%')
  }
}

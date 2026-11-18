import { picker } from '@kit.CoreFileKit';
import { webview } from '@kit.ArkWeb';

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

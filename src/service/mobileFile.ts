/** 系统选择器提供 File 内容，不将 content URI 当作磁盘路径。 */
export function pickMobileMarkdown(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // 部分 Android 文档提供器将 Markdown 标为 application/octet-stream，允许选择后校验扩展名。
    input.style.display = "none";
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

export function decodeMobileMarkdown(
  name: string,
  raw: string
): { content: string; fileTraits: FileTraitsDTO } {
  if (!/\.(md|markdown|mdown|mkd|mkdn)$/i.test(name)) {
    throw new Error("请选择 Markdown 文件（.md 或 .markdown）");
  }
  return {
    content: raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
    fileTraits: {
      hasBOM: raw.startsWith("\uFEFF"),
      lineEnding: raw.includes("\r\n") ? "crlf" : "lf",
      hasTrailingNewline: raw.endsWith("\n"),
    },
  };
}

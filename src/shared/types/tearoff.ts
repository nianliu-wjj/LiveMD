export interface FileTraitsDTO {
  hasBOM: boolean;
  lineEnding: "crlf" | "lf";
  hasTrailingNewline: boolean;
}

export interface TearOffTabData {
  kind?: "markdown" | "html";
  id: string;
  name: string;
  filePath: string | null;
  content: string;
  originalContent: string;
  isModified: boolean;
  scrollRatio?: number;
  readOnly: boolean;
  fileTraits?: FileTraitsDTO;
}

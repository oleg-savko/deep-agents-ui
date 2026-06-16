"use client";

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { FileText, Copy, Download, Edit, Save, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { toast } from "sonner";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type { FileItem } from "@/app/types/types";
import useSWRMutation from "swr/mutation";

// Non-text, non-pdf, non-image binary types → download-only preview, with the
// MIME used to build a valid download Blob.
const BINARY_MIME_MAP: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  zip: "application/zip",
};

// Styles for the SheetJS-generated spreadsheet tables (sheet_to_html output).
const XLSX_PREVIEW_CSS = `
.xlsx-preview .sheet-name { font-size: 0.8rem; font-weight: 600; color: #266BD1;
  margin: 1rem 0 0.4rem; text-transform: uppercase; letter-spacing: 0.03em; }
.xlsx-preview .sheet-name:first-child { margin-top: 0; }
.xlsx-preview table { border-collapse: collapse; width: max-content; min-width: 100%;
  font-size: 0.78rem; margin-bottom: 1rem; }
.xlsx-preview td, .xlsx-preview th { border: 1px solid var(--color-border, #e3ebf7);
  padding: 4px 8px; white-space: nowrap; vertical-align: top; }
.xlsx-preview tr:first-child td { background: rgba(38,107,209,0.10);
  font-weight: 600; position: sticky; top: 0; }
`;

const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  c: "c",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export const FileViewDialog = React.memo<{
  file: FileItem | null;
  onSaveFile: (fileName: string, content: string) => Promise<void>;
  onClose: () => void;
  editDisabled: boolean;
}>(({ file, onSaveFile, onClose, editDisabled }) => {
  const [isEditingMode, setIsEditingMode] = useState(file === null);
  const [fileName, setFileName] = useState(String(file?.path || ""));
  const [fileContent, setFileContent] = useState(String(file?.content || ""));

  const fileUpdate = useSWRMutation(
    { kind: "files-update", fileName, fileContent },
    async ({ fileName, fileContent }) => {
      if (!fileName || !fileContent) return;
      return await onSaveFile(fileName, fileContent);
    },
    {
      onSuccess: () => setIsEditingMode(false),
      onError: (error) => toast.error(`Failed to save file: ${error}`),
    }
  );

  useEffect(() => {
    setFileName(String(file?.path || ""));
    setFileContent(String(file?.content || ""));
    setIsEditingMode(file === null);
  }, [file]);

  const fileExtension = useMemo(() => {
    const fileNameStr = String(fileName || "");
    return fileNameStr.split(".").pop()?.toLowerCase() || "";
  }, [fileName]);

  const isMarkdown = useMemo(() => {
    return fileExtension === "md" || fileExtension === "markdown";
  }, [fileExtension]);

  // Binary files are stored base64-encoded (FileData encoding="base64"). Render
  // them per type (PDF/image inline; others download-only) instead of as text.
  const isPdf = useMemo(() => fileExtension === "pdf", [fileExtension]);
  const isImage = useMemo(
    () => ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(fileExtension),
    [fileExtension]
  );
  const isSpreadsheet = useMemo(
    () => ["xlsx", "xls"].includes(fileExtension),
    [fileExtension]
  );
  const binaryMime = useMemo(
    () => BINARY_MIME_MAP[fileExtension] || null,
    [fileExtension]
  );
  const isBinary = isPdf || isImage || binaryMime !== null;

  const pdfDataUrl = useMemo(
    () => (isPdf && fileContent ? `data:application/pdf;base64,${fileContent}` : null),
    [isPdf, fileContent]
  );
  const imageDataUrl = useMemo(() => {
    if (!isImage || !fileContent) return null;
    const mime = fileExtension === "svg" ? "image/svg+xml" : `image/${fileExtension === "jpg" ? "jpeg" : fileExtension}`;
    return `data:${mime};base64,${fileContent}`;
  }, [isImage, fileContent, fileExtension]);

  // Spreadsheet preview: parse the base64 workbook to HTML tables (one per sheet)
  // via SheetJS, loaded lazily so it never enters the main bundle.
  const [sheetHtml, setSheetHtml] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState(false);
  useEffect(() => {
    if (!isSpreadsheet || !fileContent) {
      setSheetHtml(null);
      setSheetError(false);
      return;
    }
    let cancelled = false;
    setSheetHtml(null);
    setSheetError(false);
    import("xlsx")
      .then((XLSX) => {
        const wb = XLSX.read(fileContent, { type: "base64" });
        const parts = wb.SheetNames.map((name) => {
          const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { id: "" });
          return `<h3 class="sheet-name">${name}</h3>${html}`;
        });
        if (!cancelled) setSheetHtml(parts.join("\n"));
      })
      .catch(() => {
        if (!cancelled) setSheetError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isSpreadsheet, fileContent]);

  const language = useMemo(() => {
    return LANGUAGE_MAP[fileExtension] || "text";
  }, [fileExtension]);

  const handleCopy = useCallback(() => {
    if (fileContent) {
      navigator.clipboard.writeText(fileContent);
    }
  }, [fileContent]);

  const handleDownload = useCallback(() => {
    if (!fileContent || !fileName) return;
    let blob: Blob;
    if (isBinary) {
      // base64 → bytes for a valid binary download (pdf/image/xlsx/…).
      const mime = isPdf
        ? "application/pdf"
        : isImage
          ? (imageDataUrl?.slice(5, imageDataUrl.indexOf(";")) ?? "application/octet-stream")
          : (binaryMime ?? "application/octet-stream");
      try {
        const binary = atob(fileContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: mime });
      } catch {
        return;
      }
    } else {
      blob = new Blob([fileContent], { type: "text/plain" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [fileContent, fileName, isBinary, isPdf, isImage, imageDataUrl, binaryMime]);

  const handleEdit = useCallback(() => {
    setIsEditingMode(true);
  }, []);

  const handleCancel = useCallback(() => {
    if (file === null) {
      onClose();
    } else {
      setFileName(String(file.path));
      setFileContent(String(file.content));
      setIsEditingMode(false);
    }
  }, [file, onClose]);

  const fileNameIsValid = useMemo(() => {
    return (
      fileName.trim() !== "" &&
      !fileName.includes("/") &&
      !fileName.includes(" ")
    );
  }, [fileName]);

  return (
    <Dialog
      open={true}
      onOpenChange={onClose}
    >
      <DialogContent className="flex h-[80vh] max-h-[80vh] min-w-[60vw] flex-col p-6">
        <DialogTitle className="sr-only">
          {file?.path || "New File"}
        </DialogTitle>
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="text-primary/50 h-5 w-5 shrink-0" />
            {isEditingMode && file === null ? (
              <Input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Enter filename..."
                className="text-base font-medium"
                aria-invalid={!fileNameIsValid}
              />
            ) : (
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-primary">
                {file?.path}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!isEditingMode && (
              <>
                {!isBinary && (
                  <>
                    <Button
                      onClick={handleEdit}
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      disabled={editDisabled}
                    >
                      <Edit
                        size={16}
                        className="mr-1"
                      />
                      Edit
                    </Button>
                    <Button
                      onClick={handleCopy}
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                    >
                      <Copy
                        size={16}
                        className="mr-1"
                      />
                      Copy
                    </Button>
                  </>
                )}
                <Button
                  onClick={handleDownload}
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                >
                  <Download
                    size={16}
                    className="mr-1"
                  />
                  Download
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {isPdf ? (
            pdfDataUrl ? (
              <iframe
                src={pdfDataUrl}
                title={file?.path || "PDF"}
                className="h-full w-full rounded-md border border-border"
              />
            ) : (
              <div className="flex items-center justify-center p-12">
                <p className="text-sm text-muted-foreground">File is empty</p>
              </div>
            )
          ) : isImage ? (
            imageDataUrl ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img
                  src={imageDataUrl}
                  alt={file?.path || "image"}
                  className="max-h-full max-w-full rounded-md object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center p-12">
                <p className="text-sm text-muted-foreground">File is empty</p>
              </div>
            )
          ) : isSpreadsheet ? (
            sheetHtml !== null ? (
              <ScrollArea className="bg-surface h-full rounded-md">
                <style>{XLSX_PREVIEW_CSS}</style>
                <div
                  className="xlsx-preview p-4"
                  dangerouslySetInnerHTML={{ __html: sheetHtml }}
                />
              </ScrollArea>
            ) : sheetError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
                <FileText className="h-10 w-10 text-primary/40" />
                <p className="text-sm text-muted-foreground">
                  Could not preview this spreadsheet. Use Download to open it.
                </p>
                <Button onClick={handleDownload} size="sm">
                  <Download size={16} className="mr-1" />
                  Download
                </Button>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )
          ) : isBinary ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
              <FileText className="h-10 w-10 text-primary/40" />
              <p className="text-sm text-muted-foreground">
                Preview not available for this file type. Use Download to open it.
              </p>
              <Button onClick={handleDownload} size="sm">
                <Download size={16} className="mr-1" />
                Download
              </Button>
            </div>
          ) : isEditingMode ? (
            <Textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              placeholder="Enter file content..."
              className="h-full min-h-[400px] resize-none font-mono text-sm"
            />
          ) : (
            <ScrollArea className="bg-surface h-full rounded-md">
              <div className="p-4">
                {fileContent ? (
                  isMarkdown ? (
                    <div className="rounded-md p-6">
                      <MarkdownContent content={fileContent} />
                    </div>
                  ) : (
                    <SyntaxHighlighter
                      language={language}
                      style={oneDark}
                      customStyle={{
                        margin: 0,
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                      }}
                      showLineNumbers
                      wrapLines={true}
                      lineProps={{
                        style: {
                          whiteSpace: "pre-wrap",
                        },
                      }}
                    >
                      {fileContent}
                    </SyntaxHighlighter>
                  )
                ) : (
                  <div className="flex items-center justify-center p-12">
                    <p className="text-sm text-muted-foreground">
                      File is empty
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
        {isEditingMode && (
          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              onClick={handleCancel}
              variant="outline"
              size="sm"
            >
              <X
                size={16}
                className="mr-1"
              />
              Cancel
            </Button>
            <Button
              onClick={() => fileUpdate.trigger()}
              size="sm"
              disabled={
                fileUpdate.isMutating ||
                !fileName.trim() ||
                !fileContent.trim() ||
                !fileNameIsValid
              }
            >
              {fileUpdate.isMutating ? (
                <Loader2
                  size={16}
                  className="mr-1 animate-spin"
                />
              ) : (
                <Save
                  size={16}
                  className="mr-1"
                />
              )}
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

FileViewDialog.displayName = "FileViewDialog";

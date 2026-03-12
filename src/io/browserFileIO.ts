export async function readBrowserFileText(params: { file: File | Blob }): Promise<string> {
  return params.file.text();
}

export function makeBrowserDownloadUrl(params: { content: string; mimeType?: string }): string {
  const blob = new Blob([params.content], {
    type: params.mimeType ?? "text/plain;charset=utf-8",
  });
  return URL.createObjectURL(blob);
}

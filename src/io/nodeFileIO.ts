import { readFile, writeFile } from "node:fs/promises";

export async function readTextFile(params: { path: string }): Promise<string> {
  return readFile(params.path, "utf8");
}

export async function writeTextFile(params: { path: string; content: string }): Promise<void> {
  await writeFile(params.path, params.content, "utf8");
}

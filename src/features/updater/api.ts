import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

/** @adr ADR-0013.D4 */
export type UpdateCheck = { status: "current" } | { status: "available"; update: Update };

/** @adr ADR-0013.D4 */
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

/** Asks the release-hosted latest.json whether a newer signed build exists. Only called on a user action. @adr ADR-0013.D4 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const update = await check();
  return update ? { status: "available", update } : { status: "current" };
}

/** @adr ADR-0013.D4 */
export function applyDownloadEvent(progress: DownloadProgress, event: DownloadEvent): DownloadProgress {
  if (event.event === "Started") return { downloaded: 0, total: event.data.contentLength ?? null };
  if (event.event === "Progress") return { ...progress, downloaded: progress.downloaded + event.data.chunkLength };
  return progress;
}

/** Downloads, verifies the signature (done by the updater plugin), installs, then restarts. @adr ADR-0013.D4 */
export async function installUpdate(update: Update, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  let progress: DownloadProgress = { downloaded: 0, total: null };
  await update.downloadAndInstall((event) => {
    progress = applyDownloadEvent(progress, event);
    onProgress(progress);
  });
  await relaunch();
}

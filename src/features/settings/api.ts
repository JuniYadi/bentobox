import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0016.D5 */
export type SettingValue = boolean | string;

/** @adr ADR-0016.D5 */
export function settingsGetAll(): Promise<Record<string, SettingValue>> {
  return invoke("settings_get_all");
}

/** @adr ADR-0016.D5 */
export function settingsGet(key: string): Promise<SettingValue | null> {
  return invoke("settings_get", { key });
}

/** @adr ADR-0016.D5 */
export function settingsSet(key: string, value: SettingValue): Promise<void> {
  return invoke("settings_set", { key, value });
}

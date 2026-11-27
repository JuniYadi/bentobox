import { invoke } from "@tauri-apps/api/core";

/** @adr ADR-0004.D1 */
export type AuthState = "authenticated" | "unauthenticated" | "unknown" | "unavailable";

/** @adr ADR-0004.D1 */
export interface AuthStatus {
  state: AuthState;
  auth_method: string | null;
}

/** @adr ADR-0004.D1 */
export function getAuthStatus(harnessId: string): Promise<AuthStatus> {
  return invoke<AuthStatus>("auth_status", { harnessId });
}

/** @adr ADR-0004.D1 */
export function startAuthLogin(harnessId: string): Promise<void> {
  return invoke<void>("auth_login", { harnessId });
}

/** @adr ADR-0004.D1 */
export function startAuthLogout(harnessId: string): Promise<void> {
  return invoke<void>("auth_logout", { harnessId });
}

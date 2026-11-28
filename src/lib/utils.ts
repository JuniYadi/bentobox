/** @adr ADR-0016.D1 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** @adr ADR-0016.D1 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

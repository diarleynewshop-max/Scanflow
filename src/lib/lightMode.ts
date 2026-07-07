export const LIGHT_MODE_KEY = "scan_newshop_light_mode";

export function getLightModeEnabled(): boolean {
  try {
    return localStorage.getItem(LIGHT_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function applyLightModeClass(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light-mode", enabled);
}

export function setLightModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIGHT_MODE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore
  }
  applyLightModeClass(enabled);
}


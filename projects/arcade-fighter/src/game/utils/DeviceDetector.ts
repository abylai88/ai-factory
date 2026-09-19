export interface DeviceInfo {
  isTouchDevice: boolean;
  isTablet: boolean;
  isMobile: boolean;
  isDesktop: boolean;
  perfTier: "low" | "medium" | "high";
  screenWidth: number;
  screenHeight: number;
}

function detectTablet(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 0 && window.innerWidth >= 768) return true;
  return false;
}

function detectPerfTier(): "low" | "medium" | "high" {
  if (typeof navigator === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Record<string, unknown>["deviceMemory"]) as number | undefined;
  if (cores <= 2 || (memory !== undefined && memory <= 2)) return "low";
  if (cores >= 8 && (memory === undefined || memory >= 4)) return "high";
  return "medium";
}

export function detectDevice(): DeviceInfo {
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isTablet = detectTablet();
  const isMobile = isTouchDevice && !isTablet;
  const isDesktop = !isTouchDevice;

  return {
    isTouchDevice,
    isTablet,
    isMobile,
    isDesktop,
    perfTier: detectPerfTier(),
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
  };
}

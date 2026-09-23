// Manage scan session state across routes
export interface ScanSessionData {
  imageDataBase64: string; // Base64 data URL
  mimeType: 'image/jpeg' | 'image/webp' | 'image/png';
}

// In-memory store is safer for large image base64 strings
// than sessionStorage which typically has a ~5MB hard limit.
let memorySession: ScanSessionData | null = null;

export function saveScanSession(data: ScanSessionData) {
  memorySession = data;
}

export function getScanSession(): ScanSessionData | null {
  return memorySession;
}

export function clearScanSession() {
  memorySession = null;
}

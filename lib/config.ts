const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://placeiq-backend-e7ik.onrender.com';

const config = {
  apiUrl: API_URL,
}
export default config

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 30000,
): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    if (e instanceof Error && e.name === 'AbortError') return null;
    throw e;
  }
}

export function startKeepAlive() {
  if (typeof window === 'undefined') return;
  const ping = () => fetch(`${API_URL}/health`).catch(() => {});
  ping();
  setInterval(ping, 14 * 60 * 1000);
}

const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
}
export default config

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export function startKeepAlive() {
  if (typeof window === 'undefined') return;
  const ping = () =>
    fetch(`${config.apiUrl}/health`, { cache: 'no-store' }).catch(() => {});
  ping();
  setInterval(ping, 14 * 60 * 1000);
}

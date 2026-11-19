export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = body.detail;
    throw new Error(
      typeof detail === "string" ? detail : Array.isArray(detail) ? JSON.stringify(detail) : response.statusText
    );
  }
  return response.json();
}

/** Multipart upload helper — do not set Content-Type (browser sets boundary). */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = body.detail;
    throw new Error(
      typeof detail === "string" ? detail : Array.isArray(detail) ? JSON.stringify(detail) : response.statusText
    );
  }
  return response.json();
}

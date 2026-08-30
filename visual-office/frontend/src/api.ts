export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = "Request failed";
    try {
      const body = await response.json() as { error?: string };
      message = body.error ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!configuredUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. Configure it in mobile/.env and restart Expo.',
    );
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTP or HTTPS.');
  }

  return configuredUrl.replace(/\/+$/, '');
}

function getErrorDetails(payload: unknown): { message?: string; code?: string } {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return {};
  }

  const error = payload.error;
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  return {
    message:
      'message' in error && typeof error.message === 'string' ? error.message : undefined,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API request paths must start with a single slash.');
  }

  const baseUrl = getApiBaseUrl();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new Error('Could not reach the agriMentor API. Check the network connection and API address.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiRequestError(`API request failed with status ${response.status}.`, response.status);
    }
    throw new Error('The API returned a response that was not JSON.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The API returned invalid JSON.');
  }

  if (!response.ok) {
    const details = getErrorDetails(payload);
    throw new ApiRequestError(
      details.message ?? `API request failed with status ${response.status}.`,
      response.status,
      details.code,
    );
  }

  return payload as T;
}

export interface ApiHealthResponse {
  application: 'agriMentor';
  status: 'ok';
  api: 'available';
  environment: string;
}

export function checkApiHealth(): Promise<ApiHealthResponse> {
  return apiRequest<ApiHealthResponse>('/health');
}

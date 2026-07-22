const BASE = '';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = localStorage.getItem('modelProbeSecret');
  if (secret) h['X-Model-Probe-Secret'] = secret;
  return h;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || res.statusText, res.status);
  }
  return data;
}

export type Endpoint = {
  id: number;
  name: string;
  type: string;
  base_url: string;
  default_model?: string;
  claimed_context_tokens?: number;
  azure?: Record<string, string>;
  dropParams?: string[];
  addParams?: Record<string, unknown>;
  last_test_ok?: number;
  last_test_error?: string;
  hasApiKey?: boolean;
};

export const api = {
  listEndpoints: () => request<{ success: boolean; data: Endpoint[] }>('/api/endpoints'),
  getEndpoint: (id: number) => request<{ success: boolean; data: Endpoint }>(`/api/endpoints/${id}`),
  createEndpoint: (body: unknown) =>
    request<{ success: boolean; data: Endpoint }>('/api/endpoints', { method: 'POST', body: JSON.stringify(body) }),
  updateEndpoint: (id: number, body: unknown) =>
    request<{ success: boolean; data: Endpoint }>(`/api/endpoints/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteEndpoint: (id: number) =>
    request<{ success: boolean }>(`/api/endpoints/${id}`, { method: 'DELETE' }),
  copyEndpoint: (id: number) =>
    request<{ success: boolean; data: Endpoint }>(`/api/endpoints/${id}/copy`, { method: 'POST' }),
  testEndpoint: (id: number, body: Record<string, unknown>) =>
    request<{ success: boolean; data: { ok: boolean; latencyMs: number; model?: string } }>(
      `/api/endpoints/${id}/test`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  testEndpointDraft: (body: Record<string, unknown>) =>
    request<{ success: boolean; data: { ok: boolean; latencyMs: number; model?: string } }>(
      '/api/endpoints/test',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  runProbe: (body: unknown) =>
    request<{ success: boolean; taskId: string }>('/api/probe/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTask: (taskId: string) => request<any>(`/api/probe/task/${taskId}`),
  runCapability: (body: unknown) =>
    request<{ success: boolean; taskId: string }>('/api/capability/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getCapabilityTask: (taskId: string) => request<any>(`/api/capability/task/${taskId}`),
  listReports: () => request<{ success: boolean; data: any[] }>('/api/reports'),
  getReport: (taskId: string) => request<{ success: boolean; data: any }>(`/api/reports/${taskId}`),
  deleteReport: (taskId: string) =>
    request<{ success: boolean }>(`/api/reports/${taskId}`, { method: 'DELETE' }),
  deleteReports: (taskIds: string[]) =>
    request<{ success: boolean; deleted: number }>('/api/reports/delete-batch', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),
  importReport: (body: unknown) =>
    request<{ success: boolean; taskId: string; message?: string }>('/api/reports/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

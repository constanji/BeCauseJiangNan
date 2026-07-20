const BASE = '';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = localStorage.getItem('tokenProbeSecret');
  if (secret) h['X-Token-Probe-Secret'] = secret;
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
    throw new ApiError((data as any).error || res.statusText, res.status);
  }
  return data as T;
}

export type Connection = {
  id: number;
  name: string;
  base_url: string;
  email?: string;
  agent_id?: string;
  data_source_id?: string;
  encoding?: string;
  hasPassword?: boolean;
  hasJwt?: boolean;
};

export const api = {
  listConnections: () => request<{ success: boolean; data: Connection[] }>('/api/connections'),
  createConnection: (body: unknown) =>
    request<{ success: boolean; data: Connection }>('/api/connections', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateConnection: (id: number, body: unknown) =>
    request<{ success: boolean; data: Connection }>(`/api/connections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteConnection: (id: number) =>
    request<{ success: boolean }>(`/api/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: number) =>
    request<{ success: boolean; data: { ok: boolean; agentChecked?: boolean } }>(
      `/api/connections/${id}/test`,
      {
        method: 'POST',
        body: '{}',
      },
    ),
  listAgents: (id: number) =>
    request<{ success: boolean; data: { id: string; name: string; description?: string }[] }>(
      `/api/connections/${id}/agents`,
    ),
  previewAgents: (body: { baseUrl: string; email: string; password: string }) =>
    request<{ success: boolean; data: { id: string; name: string; description?: string }[] }>(
      '/api/connections/preview-agents',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  runTask: (body: unknown) =>
    request<{ success: boolean; taskId: string }>('/api/tasks/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTask: (taskId: string) => request<{ success: boolean; data: any }>(`/api/tasks/task/${taskId}`),
  listReports: () => request<{ success: boolean; data: any[] }>('/api/reports'),
  getReport: (taskId: string) => request<{ success: boolean; data: any }>(`/api/reports/${taskId}`),
  deleteReport: (taskId: string) =>
    request<{ success: boolean }>(`/api/reports/${taskId}`, { method: 'DELETE' }),
  importReport: (body: unknown) =>
    request<{ success: boolean; taskId: string }>('/api/reports/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

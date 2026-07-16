import type { DataSourceTestResponse } from '@because/data-provider';

/**
 * 从连接测试 API 响应或异常中提取面向用户的错误文案（裸文案，不含「连接测试失败」前缀）。
 * 前缀由调用方统一拼接。
 */
export function formatConnectionTestErrorMessage(
  source: DataSourceTestResponse | { message?: string; error?: string; hint?: string } | Error | unknown,
): string {
  if (!source) {
    return '未返回错误信息';
  }

  if (source instanceof Error) {
    return source.message || '请求异常';
  }

  const payload = source as { message?: string; error?: string; hint?: string };
  const base = payload.error || payload.message;
  if (!base) {
    return '未返回具体错误信息';
  }

  if (payload.hint) {
    return `${base}。${payload.hint}`;
  }

  return base;
}

/**
 * 从 axios 等抛出的异常中解析连接测试错误（兼容 response.data）。
 * 返回裸文案，不含「连接测试失败」前缀。
 */
export function formatConnectionTestErrorFromThrown(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '请求异常';
  }

  const axiosLike = error as {
    message?: string;
    response?: { data?: DataSourceTestResponse };
  };

  if (axiosLike.response?.data) {
    return formatConnectionTestErrorMessage(axiosLike.response.data);
  }

  if (error instanceof Error) {
    return error.message || '请求异常';
  }

  return formatConnectionTestErrorMessage(error);
}

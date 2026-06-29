export type DataSourceType = 'mysql' | 'postgresql' | 'gaussdb';

export const DB_TYPES: Array<{
  value: DataSourceType;
  label: string;
  defaultPort: number;
  color: string;
  bg: string;
  activeBorder: string;
  logo: string;
}> = [
  {
    value: 'mysql',
    label: 'MySQL',
    defaultPort: 3306,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    activeBorder: 'border-green-500',
    logo: '🐬',
  },
  {
    value: 'postgresql',
    label: 'PostgreSQL',
    defaultPort: 5432,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    activeBorder: 'border-green-500',
    logo: '🐘',
  },
  {
    value: 'gaussdb',
    label: 'GaussDB',
    defaultPort: 8000,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    activeBorder: 'border-orange-500',
    logo: '🔴',
  },
];

export function typeLabel(type?: string) {
  const hit = DB_TYPES.find((item) => item.value === type);
  return hit?.label || type || 'GaussDB';
}

export function isBackendSupported(type: DataSourceType) {
  return type === 'gaussdb' || type === 'mysql';
}

export function isComingSoon(type: DataSourceType) {
  return type === 'postgresql';
}

export const UNSUPPORTED_TYPE_MSG = '该数据库类型后端尚未支持，当前仅 GaussDB 与 MySQL 可用';

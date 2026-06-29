export type LightSchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
  sampleValues?: string[];
};

export type LightSchemaContent = {
  tableName: string;
  columns: LightSchemaColumn[];
  primaryKeys?: string[];
};

export function cloneLightSchemaContent(content: LightSchemaContent): LightSchemaContent {
  return JSON.parse(JSON.stringify(content)) as LightSchemaContent;
}

export function emptyLightSchemaColumn(): LightSchemaColumn {
  return { name: '', type: 'text', nullable: true, description: '', sampleValues: [] };
}

export function parseLightSchemaContent(raw: unknown, fallbackTableName = ''): LightSchemaContent | null {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const record = obj as Record<string, unknown>;
  const columns = Array.isArray(record.columns) ? record.columns : [];
  if (columns.length === 0) return null;
  return {
    tableName: String(record.tableName || fallbackTableName),
    columns: columns.map((col) => {
      const c = col as Record<string, unknown>;
      return {
        name: String(c.name || ''),
        type: String(c.type || ''),
        nullable: c.nullable === true || c.nullable === 'YES',
        description: String(c.description || ''),
        sampleValues: Array.isArray(c.sampleValues) ? c.sampleValues.map(String) : [],
      };
    }),
    primaryKeys: Array.isArray(record.primaryKeys) ? record.primaryKeys.map(String) : [],
  };
}

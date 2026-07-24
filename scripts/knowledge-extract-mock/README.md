# 知识库抽取 Mock 数据源验收

无真实 GaussDB 时，用一个**专用 Mock 数据源**跑通完整链路：选表 → 抽取 → 列角色 → 向量化 → 测试检索。

真实 GaussDB 数据源**不会**出现「使用 Mock 数据」勾选项；只有选中 Mock 数据源时才走 fixture。

## 识别约定

| 字段 | 值 |
|------|-----|
| name | `【Mock】知识库抽取验收` |
| host | `knowledge-extract.mock` |
| database | `knowledge_extract_mock` |
| type | `gaussdb`（兼容现有枚举） |

服务端按 `host` / `database` 识别：schema/表列表返回假目录，抽取读 fixture，连接测试直接成功；向量化仍写入该数据源的 `file_vectors`。

## 一键创建 Mock 数据源

仓库根目录（需与 api 相同的 `MONGO_URI`、`CREDS_KEY`）：

```bash
node scripts/knowledge-extract-mock/ensure-mock-datasource.js
# 或指定管理员
node scripts/knowledge-extract-mock/ensure-mock-datasource.js --email=你的管理员邮箱
```

也可在「数据源管理」手动新建：host 填 `knowledge-extract.mock`，database 填 `knowledge_extract_mock`，密码任意。

## UI 验收步骤

1. 资产中心 → 知识库管理
2. 数据源下拉选择 **【Mock】知识库抽取验收**（标签会显示「Mock 验收」）
3. **指标定义** → schema=`kpi` / 表=`kpi_result_ctcx` → 从库抽取 → 配置列并向量化 → 搜「各项存款余额」
4. **机构信息** → schema=`cmdata` / 表=`c_par_brch_level` → 同上 → 搜「武进支行」或 `A0001`，确认 `leaf_child_codes` 在 full_row 中可见

## Fixture

- [`mock-kpi-definition.json`](../../api/server/services/Knowledge/__fixtures__/mock-kpi-definition.json)
- [`mock-org-info.json`](../../api/server/services/Knowledge/__fixtures__/mock-org-info.json)

## 可选：跳过 UI 只写向量

```bash
node scripts/knowledge-extract-mock/seed-vectorize.js --entityId=<Mock数据源_id> --kind=kpi
node scripts/knowledge-extract-mock/seed-vectorize.js --entityId=<Mock数据源_id> --kind=org
```

## 生产注意

不要把真实库的 host 设成 `knowledge-extract.mock`。全局环境变量 `USE_KNOWLEDGE_EXTRACT_MOCK=true` 仍会强制所有抽取走 fixture，生产勿开。

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.Base64;
import java.util.Properties;

/**
 * GaussJdbcServer — 持久化 JDBC 服务进程（供 gaussdbJdbcBridge.js 复用）
 *
 * 协议（newline-delimited JSON over stdin/stdout）：
 *   请求（stdin 每行一个 JSON）:
 *     { "id": "<reqId>", "sql": "<base64-encoded-sql>", "timeout": <秒> }
 *   响应（stdout 每行一个 JSON）:
 *     成功: { "id": "<reqId>", "rows": [...] }
 *     失败: { "id": "<reqId>", "error": "<message>" }
 *   就绪信号（进程启动后第一行输出）:
 *     { "ready": true }
 *
 * 环境变量与 GaussJdbcQuery 完全兼容：
 *   GAUSSDB_JDBC_URL / DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
 *   DB_SSL / DB_SSLMODE / DB_SCHEMA / GAUSSDB_JDBC_DRIVER
 *   GAUSSDB_JDBC_QUERY_TIMEOUT_SEC（默认 180）
 *
 * SQL 字段使用 Base64 编码，避免换行符干扰行协议。
 */
public class GaussJdbcServer {

  private static Connection conn;
  private static String jdbcUrl;
  private static Properties connProps;

  public static void main(String[] args) throws Exception {
    System.setOut(new PrintStream(System.out, true, "UTF-8"));
    System.setErr(new PrintStream(System.err, true, "UTF-8"));

    String driverClass = env("GAUSSDB_JDBC_DRIVER", "");
    if (!driverClass.isEmpty()) {
      Class.forName(driverClass);
    }

    jdbcUrl = buildJdbcUrl();
    connProps = buildProps();

    conn = DriverManager.getConnection(jdbcUrl, connProps);

    // 通知 Node.js 进程已就绪
    writeLine("{\"ready\":true}");

    BufferedReader reader = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8));

    String line;
    while ((line = reader.readLine()) != null) {
      line = line.trim();
      if (line.isEmpty()) continue;
      String response = dispatch(line);
      writeLine(response);
    }

    safeClose();
  }

  // ---- 请求分发 ----

  private static String dispatch(String jsonLine) {
    String reqId = "?";
    try {
      reqId = extractStr(jsonLine, "id");
      String b64Sql = extractStr(jsonLine, "sql");
      String b64Params = extractStr(jsonLine, "params", "");
      int timeoutSec = extractInt(jsonLine, "timeout",
          parseIntEnv("GAUSSDB_JDBC_QUERY_TIMEOUT_SEC", 180));

      String sql = new String(
          Base64.getDecoder().decode(b64Sql), StandardCharsets.UTF_8);
      String[] params = parseStringArray(decodeBase64(b64Params, "[]"));

      ensureConnected();

      try (PreparedStatement stmt = conn.prepareStatement(sql)) {
        stmt.setQueryTimeout(timeoutSec);
        for (int i = 0; i < params.length; i++) {
          stmt.setString(i + 1, params[i]);
        }
        boolean hasRs = stmt.execute();
        if (!hasRs) {
          return "{\"id\":" + q(reqId) + ",\"rows\":[],\"rowCount\":" + stmt.getUpdateCount() + "}";
        }
        try (ResultSet rs = stmt.getResultSet()) {
          return "{\"id\":" + q(reqId) + "," + rowsJson(rs) + "}";
        }
      }
    } catch (Exception e) {
      String msg = e.getMessage() == null ? e.getClass().getName() : e.getMessage();
      // 连接级错误后强制重置，下次请求会重连
      if (isConnectionError(e)) {
        safeClose();
        conn = null;
      }
      return "{\"id\":" + q(reqId) + ",\"error\":" + q(escapeJson(msg)) + "}";
    }
  }

  private static boolean isConnectionError(Exception e) {
    String msg = String.valueOf(e.getMessage()).toLowerCase();
    return msg.contains("connection") || msg.contains("socket") ||
        msg.contains("closed") || msg.contains("broken pipe");
  }

  private static void ensureConnected() throws Exception {
    try {
      if (conn != null && !conn.isClosed() && conn.isValid(3)) return;
    } catch (Exception ignored) {
    }
    conn = DriverManager.getConnection(jdbcUrl, connProps);
  }

  // ---- 结果序列化 ----

  private static String rowsJson(ResultSet rs) throws Exception {
    ResultSetMetaData meta = rs.getMetaData();
    int cols = meta.getColumnCount();
    StringBuilder sb = new StringBuilder("\"rows\":[");
    boolean first = true;
    while (rs.next()) {
      if (!first) sb.append(',');
      first = false;
      sb.append('{');
      for (int i = 1; i <= cols; i++) {
        if (i > 1) sb.append(',');
        sb.append(q(meta.getColumnLabel(i))).append(':');
        appendValue(sb, rs.getObject(i), meta.getColumnType(i));
      }
      sb.append('}');
    }
    sb.append(']');
    return sb.toString();
  }

  private static void appendValue(StringBuilder sb, Object v, int sqlType) {
    if (v == null) {
      sb.append("null");
    } else if (v instanceof Boolean) {
      sb.append(((Boolean) v) ? "true" : "false");
    } else if (v instanceof Integer || v instanceof Long
        || v instanceof Short || v instanceof Byte) {
      sb.append(v.toString());
    } else if (v instanceof Float || v instanceof Double) {
      double d = ((Number) v).doubleValue();
      if (Double.isFinite(d)) sb.append(v.toString());
      else sb.append(q(v.toString()));
    } else if (v instanceof BigDecimal || v instanceof Date
        || v instanceof Timestamp) {
      sb.append(q(escapeJson(v.toString())));
    } else if (sqlType == Types.NUMERIC || sqlType == Types.DECIMAL) {
      sb.append(q(escapeJson(v.toString())));
    } else {
      sb.append(q(escapeJson(v.toString())));
    }
  }

  // ---- 连接参数构建（与 GaussJdbcQuery 保持一致）----

  private static String buildJdbcUrl() {
    String explicit = env("GAUSSDB_JDBC_URL", "");
    if (!explicit.isEmpty()) return explicit;
    String protocol = env("GAUSSDB_JDBC_PROTOCOL", "postgresql");
    return "jdbc:" + protocol + "://"
        + env("DB_HOST", "localhost") + ":"
        + env("DB_PORT", "5432") + "/"
        + env("DB_NAME", "");
  }

  private static Properties buildProps() {
    Properties p = new Properties();
    p.setProperty("user", env("DB_USER", ""));
    p.setProperty("password", env("DB_PASSWORD", ""));
    putIfPresent(p, "ssl", env("DB_SSL", ""));
    putIfPresent(p, "sslmode",
        firstNonEmpty(env("DB_SSLMODE", ""), env("PGSSLMODE", "")));
    putIfPresent(p, "currentSchema", env("DB_SCHEMA", ""));
    p.setProperty("characterEncoding", "UTF-8");
    p.setProperty("unicode", "true");
    return p;
  }

  // ---- 轻量 JSON 解析（无外部依赖）----

  private static String extractStr(String json, String key) {
    String pat = "\"" + key + "\"";
    int ki = json.indexOf(pat);
    if (ki < 0) throw new RuntimeException("Missing key: " + key);
    int colon = json.indexOf(':', ki + pat.length());
    int start = json.indexOf('"', colon + 1);
    StringBuilder sb = new StringBuilder();
    int i = start + 1;
    while (i < json.length()) {
      char ch = json.charAt(i++);
      if (ch == '"') break;
      if (ch == '\\' && i < json.length()) {
        char esc = json.charAt(i++);
        switch (esc) {
          case '"': sb.append('"'); break;
          case '\\': sb.append('\\'); break;
          case 'n': sb.append('\n'); break;
          case 'r': sb.append('\r'); break;
          case 't': sb.append('\t'); break;
          default: sb.append(esc);
        }
      } else {
        sb.append(ch);
      }
    }
    return sb.toString();
  }

  private static String extractStr(String json, String key, String fallback) {
    String pat = "\"" + key + "\"";
    if (json.indexOf(pat) < 0) return fallback;
    return extractStr(json, key);
  }

  private static int extractInt(String json, String key, int fallback) {
    String pat = "\"" + key + "\"";
    int ki = json.indexOf(pat);
    if (ki < 0) return fallback;
    int colon = json.indexOf(':', ki + pat.length());
    int i = colon + 1;
    while (i < json.length() && Character.isWhitespace(json.charAt(i))) i++;
    StringBuilder sb = new StringBuilder();
    while (i < json.length() && Character.isDigit(json.charAt(i)))
      sb.append(json.charAt(i++));
    try { return Integer.parseInt(sb.toString()); } catch (Exception e) { return fallback; }
  }

  private static String decodeBase64(String b64, String fallback) {
    if (b64 == null || b64.isEmpty()) return fallback;
    try {
      return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    } catch (Exception e) {
      return fallback;
    }
  }

  private static String[] parseStringArray(String json) {
    if (json == null) return new String[0];
    String s = json.trim();
    if (s.length() < 2 || s.charAt(0) != '[') return new String[0];

    java.util.ArrayList<String> out = new java.util.ArrayList<>();
    int i = 1;
    while (i < s.length()) {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
      if (i >= s.length() || s.charAt(i) == ']') break;
      if (s.startsWith("null", i)) {
        out.add(null);
        i += 4;
      } else if (s.charAt(i) == '"') {
        StringBuilder sb = new StringBuilder();
        i++;
        while (i < s.length()) {
          char ch = s.charAt(i++);
          if (ch == '"') break;
          if (ch == '\\' && i < s.length()) {
            char esc = s.charAt(i++);
            switch (esc) {
              case '"': sb.append('"'); break;
              case '\\': sb.append('\\'); break;
              case 'n': sb.append('\n'); break;
              case 'r': sb.append('\r'); break;
              case 't': sb.append('\t'); break;
              default: sb.append(esc);
            }
          } else {
            sb.append(ch);
          }
        }
        out.add(sb.toString());
      } else {
        int start = i;
        while (i < s.length() && s.charAt(i) != ',' && s.charAt(i) != ']') i++;
        out.add(s.substring(start, i).trim());
      }
      while (i < s.length() && s.charAt(i) != ',' && s.charAt(i) != ']') i++;
      if (i < s.length() && s.charAt(i) == ',') i++;
    }
    return out.toArray(new String[0]);
  }

  // ---- 工具方法 ----

  private static String q(String s) {
    return "\"" + escapeJson(s) + "\"";
  }

  private static String escapeJson(String s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      switch (ch) {
        case '"': sb.append("\\\""); break;
        case '\\': sb.append("\\\\"); break;
        case '\n': sb.append("\\n"); break;
        case '\r': sb.append("\\r"); break;
        case '\t': sb.append("\\t"); break;
        default:
          if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
          else sb.append(ch);
      }
    }
    return sb.toString();
  }

  private static void writeLine(String s) {
    System.out.println(s);
    System.out.flush();
  }

  private static void safeClose() {
    if (conn != null) {
      try { conn.close(); } catch (Exception ignored) {}
      conn = null;
    }
  }

  private static String env(String name, String fallback) {
    String v = System.getenv(name);
    return v == null ? fallback : v;
  }

  private static void putIfPresent(Properties p, String k, String v) {
    if (v != null && !v.isEmpty()) p.setProperty(k, v);
  }

  private static String firstNonEmpty(String a, String b) {
    return (a == null || a.isEmpty()) ? b : a;
  }

  private static int parseIntEnv(String name, int fallback) {
    try {
      String v = System.getenv(name);
      return (v == null || v.trim().isEmpty()) ? fallback : Integer.parseInt(v.trim());
    } catch (Exception e) { return fallback; }
  }
}

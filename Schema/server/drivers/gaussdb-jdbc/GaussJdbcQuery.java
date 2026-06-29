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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

public class GaussJdbcQuery {
  public static void main(String[] args) throws Exception {
    System.setOut(new PrintStream(System.out, true, "UTF-8"));
    System.setErr(new PrintStream(System.err, true, "UTF-8"));

    if (args.length < 2) {
      throw new IllegalArgumentException("Usage: GaussJdbcQuery <base64-sql> <base64-json-params>");
    }

    String driverClass = env("GAUSSDB_JDBC_DRIVER", "");
    if (!driverClass.isEmpty()) {
      Class.forName(driverClass);
    }

    String sql = decode(args[0]);
    List<String> params = parseStringArray(decode(args[1]));
    String url = buildJdbcUrl();

    Properties props = new Properties();
    props.setProperty("user", env("DB_USER", ""));
    props.setProperty("password", env("DB_PASSWORD", ""));
    putIfPresent(props, "ssl", env("DB_SSL", ""));
    putIfPresent(props, "sslmode", firstNonEmpty(env("DB_SSLMODE", ""), env("PGSSLMODE", "")));
    putIfPresent(props, "currentSchema", env("DB_SCHEMA", ""));
    props.setProperty("characterEncoding", "UTF-8");
    props.setProperty("unicode", "true");

    try (Connection connection = DriverManager.getConnection(url, props);
        PreparedStatement statement = connection.prepareStatement(sql)) {
      int queryTimeoutSec = parseIntEnv("GAUSSDB_JDBC_QUERY_TIMEOUT_SEC", 45);
      statement.setQueryTimeout(queryTimeoutSec);
      for (int i = 0; i < params.size(); i++) {
        statement.setString(i + 1, params.get(i));
      }

      boolean hasResultSet = statement.execute();
      if (!hasResultSet) {
        System.out.print("{\"rows\":[],\"rowCount\":" + statement.getUpdateCount() + "}");
        return;
      }

      try (ResultSet resultSet = statement.getResultSet()) {
        System.out.print(toJson(resultSet));
      }
    }
  }

  private static String buildJdbcUrl() {
    String explicitUrl = env("GAUSSDB_JDBC_URL", "");
    if (!explicitUrl.isEmpty()) return explicitUrl;

    String protocol = env("GAUSSDB_JDBC_PROTOCOL", "postgresql");
    String host = env("DB_HOST", "localhost");
    String port = env("DB_PORT", "5432");
    String database = env("DB_NAME", "");
    return "jdbc:" + protocol + "://" + host + ":" + port + "/" + database;
  }

  private static String toJson(ResultSet resultSet) throws Exception {
    ResultSetMetaData meta = resultSet.getMetaData();
    int columnCount = meta.getColumnCount();
    StringBuilder sb = new StringBuilder();
    sb.append("{\"rows\":[");

    boolean firstRow = true;
    while (resultSet.next()) {
      if (!firstRow) sb.append(',');
      firstRow = false;
      sb.append('{');
      for (int i = 1; i <= columnCount; i++) {
        if (i > 1) sb.append(',');
        sb.append(quote(meta.getColumnLabel(i))).append(':');
        appendValue(sb, resultSet.getObject(i), meta.getColumnType(i));
      }
      sb.append('}');
    }

    sb.append("]}");
    return sb.toString();
  }

  private static void appendValue(StringBuilder sb, Object value, int sqlType) {
    if (value == null) {
      sb.append("null");
    } else if (value instanceof Boolean) {
      sb.append(((Boolean) value).booleanValue() ? "true" : "false");
    } else if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) {
      sb.append(value.toString());
    } else if (value instanceof Float || value instanceof Double) {
      double number = ((Number) value).doubleValue();
      if (Double.isFinite(number)) sb.append(value.toString());
      else sb.append(quote(value.toString()));
    } else if (value instanceof BigDecimal) {
      sb.append(quote(value.toString()));
    } else if (value instanceof Date || value instanceof Timestamp) {
      sb.append(quote(value.toString()));
    } else if (sqlType == Types.NUMERIC || sqlType == Types.DECIMAL) {
      sb.append(quote(value.toString()));
    } else {
      sb.append(quote(value.toString()));
    }
  }

  private static String quote(String value) {
    StringBuilder sb = new StringBuilder();
    sb.append('"');
    for (int i = 0; i < value.length(); i++) {
      char ch = value.charAt(i);
      switch (ch) {
        case '"':
          sb.append("\\\"");
          break;
        case '\\':
          sb.append("\\\\");
          break;
        case '\b':
          sb.append("\\b");
          break;
        case '\f':
          sb.append("\\f");
          break;
        case '\n':
          sb.append("\\n");
          break;
        case '\r':
          sb.append("\\r");
          break;
        case '\t':
          sb.append("\\t");
          break;
        default:
          if (ch < 0x20) {
            sb.append(String.format("\\u%04x", (int) ch));
          } else {
            sb.append(ch);
          }
      }
    }
    sb.append('"');
    return sb.toString();
  }

  private static List<String> parseStringArray(String json) {
    List<String> values = new ArrayList<>();
    String trimmed = json.trim();
    if (trimmed.equals("[]")) return values;
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      throw new IllegalArgumentException("Params must be a JSON string array");
    }

    int i = 1;
    while (i < trimmed.length() - 1) {
      while (i < trimmed.length() && Character.isWhitespace(trimmed.charAt(i))) i++;
      if (trimmed.charAt(i) != '"') throw new IllegalArgumentException("Param must be a string");
      StringBuilder value = new StringBuilder();
      i++;
      while (i < trimmed.length()) {
        char ch = trimmed.charAt(i++);
        if (ch == '"') break;
        if (ch == '\\') {
          char esc = trimmed.charAt(i++);
          switch (esc) {
            case '"': value.append('"'); break;
            case '\\': value.append('\\'); break;
            case '/': value.append('/'); break;
            case 'b': value.append('\b'); break;
            case 'f': value.append('\f'); break;
            case 'n': value.append('\n'); break;
            case 'r': value.append('\r'); break;
            case 't': value.append('\t'); break;
            case 'u':
              value.append((char) Integer.parseInt(trimmed.substring(i, i + 4), 16));
              i += 4;
              break;
            default:
              throw new IllegalArgumentException("Invalid JSON escape: " + esc);
          }
        } else {
          value.append(ch);
        }
      }
      values.add(value.toString());
      while (i < trimmed.length() && Character.isWhitespace(trimmed.charAt(i))) i++;
      if (i < trimmed.length() - 1) {
        if (trimmed.charAt(i) != ',') throw new IllegalArgumentException("Expected comma");
        i++;
      }
    }
    return values;
  }

  private static String decode(String value) {
    return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
  }

  private static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null ? fallback : value;
  }

  private static String firstNonEmpty(String first, String second) {
    return first == null || first.isEmpty() ? second : first;
  }

  private static void putIfPresent(Properties props, String key, String value) {
    if (value != null && !value.isEmpty()) props.setProperty(key, value);
  }

  private static int parseIntEnv(String name, int fallback) {
    try {
      String value = System.getenv(name);
      if (value == null || value.trim().isEmpty()) return fallback;
      return Integer.parseInt(value.trim());
    } catch (Exception ignored) {
      return fallback;
    }
  }
}

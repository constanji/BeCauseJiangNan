package ai.dat.adapter.postgresql;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.factories.DatabaseAdapterFactory;
import org.postgresql.ds.PGSimpleDataSource;

import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/7/4
 */
public class PostgreSqlDatabaseAdapterFactory implements DatabaseAdapterFactory {

    public static final String IDENTIFIER = "postgresql";

    public static final ConfigOption<String> URL =
            ConfigOptions.key("url")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("PostgreSQL JDBC URL");

    public static final ConfigOption<String> USERNAME =
            ConfigOptions.key("username")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("PostgreSQL user name");

    public static final ConfigOption<String> PASSWORD =
            ConfigOptions.key("password")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("PostgreSQL password");

    public static final ConfigOption<Duration> TIMEOUT =
            ConfigOptions.key("timeout")
                    .durationType()
                    .defaultValue(Duration.ofSeconds(60L))
                    .withDescription("PostgreSQL maximum timeout. " +
                            "The timeout should be in millisecond granularity.");

    /**
     * 可选：限定要扫描的 schema 列表（逗号分隔，例如 "public,kpi,org"）。
     * 留空时由 {@link PostgreSqlDatabaseAdapter} 自动发现库内所有用户 schema
     * （排除 pg_catalog / information_schema / pg_toast* / pg_temp*）。
     * GaussDB 等 PG 兼容库同样适用。
     */
    public static final ConfigOption<String> SCHEMAS =
            ConfigOptions.key("schemas")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Comma-separated schema list to scan (e.g. \"public,kpi,org\"). " +
                            "When omitted, all user schemas are auto-discovered. " +
                            "Useful for GaussDB / PostgreSQL multi-schema deployments.");

    @Override
    public String factoryIdentifier() {
        return IDENTIFIER;
    }

    @Override
    public Set<ConfigOption<?>> requiredOptions() {
        return new LinkedHashSet<>(List.of(URL, USERNAME, PASSWORD));
    }

    @Override
    public Set<ConfigOption<?>> optionalOptions() {
        return new LinkedHashSet<>(List.of(TIMEOUT, SCHEMAS));
    }

    @Override
    public DatabaseAdapter create(ReadableConfig config) {
        try {
            String url = config.get(URL);
            Duration timeout = config.get(TIMEOUT);
            PGSimpleDataSource dataSource = new PGSimpleDataSource();
            dataSource.setURL(url);
            config.getOptional(USERNAME).ifPresent(dataSource::setUser);
            config.getOptional(PASSWORD).ifPresent(dataSource::setPassword);
            dataSource.setConnectTimeout((int) timeout.toSeconds());

            List<String> configuredSchemas = config.getOptional(SCHEMAS)
                    .map(PostgreSqlDatabaseAdapterFactory::parseSchemas)
                    .orElse(Collections.emptyList());

            return new PostgreSqlDatabaseAdapter(dataSource, configuredSchemas);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static List<String> parseSchemas(String raw) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyList();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .collect(Collectors.toList());
    }
}

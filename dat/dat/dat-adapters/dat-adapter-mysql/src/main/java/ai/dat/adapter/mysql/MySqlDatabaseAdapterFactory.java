package ai.dat.adapter.mysql;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.factories.DatabaseAdapterFactory;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * @Author JunjieM
 * @Date 2025/7/4
 */
public class MySqlDatabaseAdapterFactory implements DatabaseAdapterFactory {

    public static final String IDENTIFIER = "mysql";

    // ---- 单例池缓存：key = url，保证同一数据库只建一个连接池 ----
    private static final Map<String, HikariDataSource> POOL_CACHE = new ConcurrentHashMap<>();

    public static final ConfigOption<String> URL =
            ConfigOptions.key("url")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("MySQL JDBC URL");

    public static final ConfigOption<String> USERNAME =
            ConfigOptions.key("username")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("MySQL user name");

    public static final ConfigOption<String> PASSWORD =
            ConfigOptions.key("password")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("MySQL password");

    public static final ConfigOption<Duration> TIMEOUT =
            ConfigOptions.key("timeout")
                    .durationType()
                    .defaultValue(Duration.ofSeconds(60L))
                    .withDescription("MySQL connection timeout. " +
                            "The timeout should be in millisecond granularity.");

    // ----- HikariCP 连接池相关配置 -----
    public static final ConfigOption<Integer> MAX_POOL_SIZE =
            ConfigOptions.key("max-pool-size")
                    .intType()
                    .defaultValue(10)
                    .withDescription("HikariCP maximum pool size.");

    public static final ConfigOption<Integer> MIN_IDLE =
            ConfigOptions.key("min-idle")
                    .intType()
                    .defaultValue(2)
                    .withDescription("HikariCP minimum idle connections.");

    public static final ConfigOption<Duration> IDLE_TIMEOUT =
            ConfigOptions.key("idle-timeout")
                    .durationType()
                    .defaultValue(Duration.ofMinutes(10L))
                    .withDescription("HikariCP idle connection timeout.");

    public static final ConfigOption<Duration> MAX_LIFETIME =
            ConfigOptions.key("max-lifetime")
                    .durationType()
                    .defaultValue(Duration.ofMinutes(30L))
                    .withDescription("HikariCP maximum connection lifetime.");

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
        return new LinkedHashSet<>(List.of(TIMEOUT, MAX_POOL_SIZE, MIN_IDLE, IDLE_TIMEOUT, MAX_LIFETIME));
    }

    @Override
    public DatabaseAdapter create(ReadableConfig config) {
        String url = config.get(URL);

        // 核心修复：相同 URL 复用同一个连接池，不重复创建
        HikariDataSource dataSource = POOL_CACHE.computeIfAbsent(url, k -> buildDataSource(config));
        return new MySqlDatabaseAdapter(dataSource);
    }

    /**
     * 构建 HikariDataSource，仅在首次对应 URL 时调用一次。
     */
    private HikariDataSource buildDataSource(ReadableConfig config) {
        String url = config.get(URL);
        Duration timeout = config.get(TIMEOUT);

        HikariConfig hk = new HikariConfig();
        hk.setJdbcUrl(url);
        config.getOptional(USERNAME).ifPresent(hk::setUsername);
        config.getOptional(PASSWORD).ifPresent(hk::setPassword);
        hk.setConnectionTimeout(timeout.toMillis());
        hk.setMaximumPoolSize(config.get(MAX_POOL_SIZE));
        hk.setMinimumIdle(config.get(MIN_IDLE));
        hk.setIdleTimeout(config.get(IDLE_TIMEOUT).toMillis());
        hk.setMaxLifetime(config.get(MAX_LIFETIME).toMillis());
        hk.setPoolName("dat-mysql-" + Integer.toHexString(System.identityHashCode(url)));

        // MySQL 推荐优化参数（HikariCP 官方建议 + connector/j 8.x）
        hk.addDataSourceProperty("cachePrepStmts", "true");
        hk.addDataSourceProperty("prepStmtCacheSize", "250");
        hk.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
        hk.addDataSourceProperty("useServerPrepStmts", "true");
        hk.addDataSourceProperty("useLocalSessionState", "true");
        hk.addDataSourceProperty("rewriteBatchedStatements", "true");
        hk.addDataSourceProperty("cacheResultSetMetadata", "true");
        hk.addDataSourceProperty("cacheServerConfiguration", "true");
        hk.addDataSourceProperty("elideSetAutoCommits", "true");
        hk.addDataSourceProperty("maintainTimeStats", "false");

        return new HikariDataSource(hk);
    }

    /**
     * 应用关闭时调用，释放所有连接池资源。
     * 可注册到 JVM ShutdownHook 或 Spring @PreDestroy。
     */
    public static void closeAll() {
        POOL_CACHE.values().forEach(ds -> {
            if (!ds.isClosed()) {
                ds.close();
            }
        });
        POOL_CACHE.clear();
    }
}
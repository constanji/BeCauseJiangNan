package ai.dat.storer.pgvector;

import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.contentstore.ContentType;
import ai.dat.core.factories.EmbeddingStoreFactory;
import ai.dat.core.utils.FactoryUtil;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.pgvector.PgVectorEmbeddingStore;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * @Author JunjieM
 * @Date 2025/9/28
 */
public class PGVectorEmbeddingStoreFactory implements EmbeddingStoreFactory {

    public static final String IDENTIFIER = "pgvector";

    public static final String DEFAULT_TABLE_NAME_PREFIX = "dat_embeddings";

    public static final ConfigOption<String> HOST =
            ConfigOptions.key("host")
                    .stringType()
                    .defaultValue("localhost")
                    .withDescription("Hostname of the PostgreSQL server.");

    public static final ConfigOption<Integer> PORT =
            ConfigOptions.key("port")
                    .intType()
                    .defaultValue(5432)
                    .withDescription("Port number of the PostgreSQL server.");

    public static final ConfigOption<String> USER =
            ConfigOptions.key("user")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Username for database authentication.");

    public static final ConfigOption<String> PASSWORD =
            ConfigOptions.key("password")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Password for database authentication.");

    public static final ConfigOption<String> DATABASE =
            ConfigOptions.key("database")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Name of the database to connect to.");

    public static final ConfigOption<String> TABLE_PREFIX =
            ConfigOptions.key("table-prefix")
                    .stringType()
                    .defaultValue(DEFAULT_TABLE_NAME_PREFIX)
                    .withDescription("The name prefix of the database table used for storing embeddings.");

    public static final ConfigOption<Integer> DIMENSION =
            ConfigOptions.key("dimension")
                    .intType()
                    .noDefaultValue()
                    .withDescription("The dimensionality of the embedding vectors. " +
                            "This should match the embedding model being used.");

    public static final ConfigOption<Boolean> USE_INDEX =
            ConfigOptions.key("use-index")
                    .booleanType()
                    .defaultValue(false)
                    .withDescription("""
                            An IVFFlat index divides vectors into lists, and then searches a subset \
                            of those lists closest to the query vector.
                            It has faster build times and uses less memory than HNSW but has lower query performance \
                            (in terms of speed-recall tradeoff).
                            """);

    public static final ConfigOption<Integer> INDEX_LIST_SIZE =
            ConfigOptions.key("index-list-size")
                    .intType()
                    .noDefaultValue()
                    .withDescription("""
                            The number of lists for the IVFFlat index.
                            If 'use-index' is true, 'index-list-size' must be provided and must be greater than zero.
                            Otherwise, the program will throw an exception during table initialization.
                            When Optional: If useIndex is false, this property is ignored and doesn’t need to be set.
                            """);

    @Override
    public String factoryIdentifier() {
        return IDENTIFIER;
    }

    @Override
    public Set<ConfigOption<?>> requiredOptions() {
        return new LinkedHashSet<>(List.of(HOST, PORT, USER, PASSWORD, DATABASE, DIMENSION));
    }

    @Override
    public Set<ConfigOption<?>> optionalOptions() {
        return new LinkedHashSet<>(List.of(TABLE_PREFIX, USE_INDEX, INDEX_LIST_SIZE));
    }

    @Override
    public Set<ConfigOption<?>> fingerprintOptions() {
        return Set.of(HOST, PORT, USER, DATABASE, TABLE_PREFIX, DIMENSION, USE_INDEX, INDEX_LIST_SIZE);
    }

    @Override
    public EmbeddingStore<TextSegment> create(String storeId,
                                              ContentType contentType,
                                              ReadableConfig config) {
        FactoryUtil.validateFactoryOptions(this, config);

        String host = config.get(HOST);
        Integer port = config.get(PORT);
        String database = config.get(DATABASE);
        String user = config.get(USER);
        String password = config.get(PASSWORD);
        String tableNamePrefix = config.get(TABLE_PREFIX);
        Integer dimension = config.get(DIMENSION);
        Boolean useIndex = config.get(USE_INDEX);

        // 清理storeId以获取安全的PostgreSQL表名（处理中文字符等）
        String safeStoreId = sanitizeForTableName(storeId);
        String tableName = String.join("_",
                tableNamePrefix,
                safeStoreId,
                contentType.getValue());

        PgVectorEmbeddingStore.PgVectorEmbeddingStoreBuilder builder = PgVectorEmbeddingStore.builder()
                // Connection and table parameters
                .host(host)
                .port(port)
                .database(database)
                .user(user)
                .password(password)
                .table(tableName)
                .dimension(dimension)

                // Table creation options
                .createTable(true) // Automatically create the table if it doesn’t exist
                .dropTableFirst(false) // Don’t drop the table first (set to true if you want a fresh start)

                // Indexing and performance options
                .useIndex(useIndex);

        // Number of lists for IVFFlat index
        config.getOptional(INDEX_LIST_SIZE).ifPresent(builder::indexListSize);

        return builder.build();
    }

    /**
    * 清理storeId以获取安全的PostgreSQL表名。
    * 将非ASCII字符（如中文）转换为MD5散列，保持ASCII
    * 字母数字和下划线。
     */
    private String sanitizeForTableName(String storeId) {
        if (storeId == null || storeId.isEmpty()) {
            return "default";
        }

        // 检查storeId是否只包含安全字符（ASCII字母数字和下划线）
        if (storeId.matches("^[a-zA-Z0-9_]+$")) {
            return storeId.replace('-', '_');
        }

        // 包含不安全字符，请使用MD5
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(storeId.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString().substring(0, 16); // 使用MD5的前16个字符
        } catch (java.security.NoSuchAlgorithmException e) {
            // 备用方案：过滤掉非ascii码并使用剩下的，或者生成时间戳
            String filtered = storeId.replaceAll("[^a-zA-Z0-9_]", "");
            return filtered.isEmpty() ? "store_" + System.currentTimeMillis() : filtered;
        }
    }
}

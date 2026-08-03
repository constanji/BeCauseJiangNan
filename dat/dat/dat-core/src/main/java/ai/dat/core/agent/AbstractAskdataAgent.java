package ai.dat.core.agent;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.agent.data.StreamEvent;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;

import java.sql.SQLException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

import static ai.dat.core.agent.DefaultEventOptions.*;

/**
 * @Author JunjieM
 * @Date 2025/6/25
 */
@Slf4j
public abstract class AbstractAskdataAgent implements AskdataAgent {

    protected static final ExecutorService executor = Executors.newCachedThreadPool(new ThreadFactory() {
        private final AtomicInteger id = new AtomicInteger(0);

        @Override
        public Thread newThread(Runnable r) {
            Thread thread = new Thread(r);
            thread.setName("dat-agent-" + id.addAndGet(1));
            return thread;
        }
    });

    /**
     * 请求级 attributes 通道。
     * <p>用法:子类的 {@code run()} 内通过 {@link #requestAttributes()} 取出本次问数的请求参数。
     *
     * <p>实现细节:{@link #ask(String, List, Map)} 在异步 {@code run()} 之前往本 ThreadLocal 写入,
     * {@code finally} 里清理,确保不同请求之间隔离;线程池线程也不会泄漏旧值。
     */
    protected static final ThreadLocal<Map<String, Object>> REQUEST_ATTRIBUTES = new ThreadLocal<>();

    protected final StreamAction action = new StreamAction();

    protected final ContentStore contentStore;
    protected final DatabaseAdapter databaseAdapter;
    protected final Map<String, Object> variables;

    public AbstractAskdataAgent(@NonNull ContentStore contentStore,
                                @NonNull DatabaseAdapter databaseAdapter,
                                Map<String, Object> variables) {
        this.contentStore = contentStore;
        this.databaseAdapter = databaseAdapter;
        this.variables = Optional.ofNullable(variables).orElse(Collections.emptyMap());
    }

    @Deprecated
    public AbstractAskdataAgent(@NonNull ContentStore contentStore,
                                @NonNull DatabaseAdapter databaseAdapter) {
        this(contentStore, databaseAdapter, null);
    }

    @Override
    public ContentStore contentStore() {
        return contentStore;
    }

    @Override
    public DatabaseAdapter databaseAdapter() {
        return databaseAdapter;
    }


    @Override
    public StreamAction ask(@NonNull String question) {
        return ask(question, Collections.emptyList());
    }

    @Override
    public StreamAction ask(@NonNull String question, @NonNull List<QuestionSqlPair> histories) {
        return ask(question, histories, Collections.emptyMap());
    }

    @Override
    public StreamAction ask(@NonNull String question,
                             @NonNull List<QuestionSqlPair> histories,
                             Map<String, Object> attributes) {
        action.start();
        Map<String, Object> attrs = attributes == null ? Collections.emptyMap() : attributes;
        executor.execute(() -> {
            REQUEST_ATTRIBUTES.set(attrs);
            try {
                run(question, histories);
            } catch (Exception e) {
                log.error("Ask data exception", e);
                action.add(StreamEvent.from(EXCEPTION_EVENT, MESSAGE, e.getMessage()));
            } finally {
                REQUEST_ATTRIBUTES.remove();
                action.finished();
            }
        });
        return action;
    }

    protected abstract void run(String question, List<QuestionSqlPair> histories);

    /**
     * 取本次问数的请求级 attributes(子类 {@code run()} 内调用)。
     * 当 {@code ask} 没传 attributes 时返回不可变空 Map。
     */
    protected Map<String, Object> requestAttributes() {
        Map<String, Object> attrs = REQUEST_ATTRIBUTES.get();
        return attrs == null ? Collections.emptyMap() : attrs;
    }

    /**
     * Execute SQL directly
     */
    protected List<Map<String, Object>> executeQuery(@NonNull String sql) throws SQLException {
        log.info("dialectSql: " + sql);
        try {
            List<Map<String, Object>> results = databaseAdapter.executeQuery(sql);
            action.add(StreamEvent.from(SQL_EXECUTE_EVENT, DATA, results));
            return results;
        } catch (SQLException e) {
            action.add(StreamEvent.from(SQL_EXECUTE_EVENT, ERROR, e.getMessage()));
            throw new SQLException(e);
        }
    }

}


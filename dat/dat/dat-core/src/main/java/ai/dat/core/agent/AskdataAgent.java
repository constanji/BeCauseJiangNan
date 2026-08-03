package ai.dat.core.agent;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.agent.data.EventOption;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import dev.langchain4j.exception.UnsupportedFeatureException;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 问数Agent接口类
 *
 * @Author JunjieM
 * @Date 2025/6/25
 */
public interface AskdataAgent {

    ContentStore contentStore();

    DatabaseAdapter databaseAdapter();


    Set<EventOption> eventOptions();

    StreamAction ask(String question);

    StreamAction ask(String question, List<QuestionSqlPair> histories);

    /**
     * 带请求级 attributes 的 ask 重载(每次问数都可能不同的参数走这里)。
     * <p>
     * 与构造期 {@code variables} 的区别:
     * <ul>
     *   <li>{@code variables} 项目级 / 长生命周期,Runner 缓存复用,一次构造永久共享;</li>
     *   <li>{@code attributes} 请求级 / 单次生效,不污染其他并发请求。</li>
     * </ul>
     * 典型用法:把指标问数的 {@code IndexContext} / orgCode / staffNo 等请求级参数塞进 attributes,
     * 由 {@link AbstractAskdataAgent} 通过 ThreadLocal 透传到 {@code run()} 内部。
     *
     * <p>默认实现忽略 attributes,委托到 {@link #ask(String, List)},保证向后兼容。
     */
    default StreamAction ask(String question,
                              List<QuestionSqlPair> histories,
                              Map<String, Object> attributes) {
        return ask(question, histories);
    }

    /**
     * Human-in-the-loop user (human) response
     *
     * @param response
     */
    default void userResponse(String response) {
        throw new UnsupportedFeatureException("Not supported yet.");
    }

    /**
     * Human-in-the-loop user (human) approval
     *
     * @param approval
     */
    default void userApproval(Boolean approval) {
        throw new UnsupportedFeatureException("Not supported yet.");
    }
}
package ai.dat.server.openapi.config;

import ai.dat.core.index.bm25.IndexBm25Index;
import ai.dat.core.index.provider.IndexEntryProvider;
import ai.dat.core.index.provider.OrgPermissionProvider;
import ai.dat.core.index.resolver.CurrencyDetector;
import ai.dat.core.index.resolver.DateScenarioDetector;
import ai.dat.core.index.resolver.IndexContextResolver;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 指标问数所需的 Spring bean 装配。
 * <p>
 * 仅当 Mongo 模式 + `IndexEntryProvider` / `OrgPermissionProvider` 两个 provider
 * (由 dat-datastore 提供)都在容器内时注册 Resolver。这意味着:
 * <ul>
 *   <li>Mongo 不可用 → 两个 provider 不存在 → 整套 IndexContext 链路自动跳过;</li>
 *   <li>Resolver 不存在时 AskController 用 Optional 注入,正常走通用问数流程。</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Configuration
public class IndexAskConfig {

    @Bean
    public DateScenarioDetector dateScenarioDetector() {
        return new DateScenarioDetector();
    }

    @Bean
    public CurrencyDetector currencyDetector() {
        return new CurrencyDetector();
    }

    @Bean
    @ConditionalOnBean({IndexEntryProvider.class, OrgPermissionProvider.class})
    public IndexBm25Index bm25Index() {
        return new IndexBm25Index();
    }

    @Bean
    @ConditionalOnBean({IndexEntryProvider.class, OrgPermissionProvider.class})
    public IndexContextResolver indexContextResolver(IndexEntryProvider indexProvider,
                                                      OrgPermissionProvider permProvider,
                                                      DateScenarioDetector dateDetector,
                                                      CurrencyDetector currencyDetector,
                                                      IndexBm25Index bm25Index) {
        log.info("IndexContextResolver enabled (Mongo providers detected)");
        return new IndexContextResolver(indexProvider, permProvider, dateDetector, currencyDetector, bm25Index);
    }
}

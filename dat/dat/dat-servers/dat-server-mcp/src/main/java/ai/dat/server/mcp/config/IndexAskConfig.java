package ai.dat.server.mcp.config;

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
 * MCP 端的指标问数 bean 装配,与 OpenAPI 端保持一致。
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
        log.info("MCP IndexContextResolver enabled (Mongo providers detected)");
        return new IndexContextResolver(indexProvider, permProvider, dateDetector, currencyDetector, bm25Index);
    }
}

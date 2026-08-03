package ai.dat.server.openapi.config;

import ai.dat.server.openapi.service.StreamingCacheService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 流式缓存清理调度配置
 */
@Slf4j
@Configuration
@EnableScheduling
public class StreamingCacheCleanupScheduler {

    private final StreamingCacheService streamingCacheService;

    public StreamingCacheCleanupScheduler(StreamingCacheService streamingCacheService) {
        this.streamingCacheService = streamingCacheService;
    }

    /**
     * 每5分钟清理一次超过30分钟的已完成会话
     */
    @Scheduled(fixedRate = 300000) // 5分钟
    public void cleanupOldSessions() {
        long maxAge = 30 * 60 * 1000; // 30分钟
        streamingCacheService.cleanupOldSessions(maxAge);
    }
}

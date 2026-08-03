package ai.dat.server.openapi.service;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 流式内容缓存服务，用于支持前端循环调用获取分段内容
 */
@Slf4j
@Service
public class StreamingCacheService {

    /**
     * 缓存的流式会话数据
     */
    private final Map<String, StreamSession> sessions = new ConcurrentHashMap<>();

    /**
     * 创建新的流式会话
     *
     * @param sessionId 会话唯一ID
     * @return 会话ID
     */
    public String createSession(String sessionId) {
        StreamSession session = new StreamSession();
        session.setSessionId(sessionId);
        session.setStartTime(System.currentTimeMillis());
        session.setFinished(false);
        sessions.put(sessionId, session);
        log.debug("Created streaming session: {}", sessionId);
        return sessionId;
    }

    /**
     * 添加内容片段到会话
     *
     * @param sessionId 会话ID
     * @param content   内容片段
     */
    public void appendContent(String sessionId, String content) {
        StreamSession session = sessions.get(sessionId);
        if (session != null) {
            session.getContentChunks().add(content);
            log.trace("Appended content to session {}: {} chars", sessionId, content.length());
        } else {
            log.warn("Session not found: {}", sessionId);
        }
    }

    /**
     * 设置会话的元数据
     *
     * @param sessionId 会话ID
     * @param key       元数据键
     * @param value     元数据值
     */
    public void setMetadata(String sessionId, String key, Object value) {
        if (key == null || value == null) {
            return;
        }
        StreamSession session = sessions.get(sessionId);
        if (session != null) {
            session.getMetadata().put(key, value);
        }
    }

    /**
     * 标记会话已完成
     *
     * @param sessionId 会话ID
     */
    public void markFinished(String sessionId) {
        StreamSession session = sessions.get(sessionId);
        if (session != null) {
            session.setFinished(true);
            session.setEndTime(System.currentTimeMillis());
            log.debug("Session marked as finished: {}", sessionId);
        }
    }

    /**
     * 标记会话失败
     *
     * @param sessionId 会话ID
     * @param error     错误信息
     */
    public void markError(String sessionId, String error) {
        StreamSession session = sessions.get(sessionId);
        if (session != null) {
            session.setFinished(true);
            session.setError(true);
            session.setErrorMessage(error);
            session.setEndTime(System.currentTimeMillis());
            log.debug("Session marked as error: {}, error: {}", sessionId, error);
        }
    }

    /**
     * 获取会话从指定偏移量开始的内容
     *
     * @param sessionId 会话ID
     * @param offset    偏移量（已读取的片段数量）
     * @return 会话数据片段
     */
    public StreamChunk getChunk(String sessionId, int offset) {
        StreamSession session = sessions.get(sessionId);
        if (session == null) {
            return StreamChunk.notFound();
        }

        StreamChunk chunk = new StreamChunk();
        chunk.setSessionId(sessionId);
        chunk.setOffset(offset);
        chunk.setFinished(session.isFinished());
        chunk.setError(session.isError());
        chunk.setErrorMessage(session.getErrorMessage());
        chunk.setMetadata(session.getMetadata());

        // 获取从 offset 开始的新内容
        CopyOnWriteArrayList<String> contentChunks = session.getContentChunks();
        if (offset < contentChunks.size()) {
            StringBuilder content = new StringBuilder();
            for (int i = offset; i < contentChunks.size(); i++) {
                content.append(contentChunks.get(i));
            }
            chunk.setContent(content.toString());
            chunk.setNextOffset(contentChunks.size());
        } else {
            chunk.setContent("");
            chunk.setNextOffset(offset);
        }

        return chunk;
    }

    /**
     * 清理会话
     *
     * @param sessionId 会话ID
     */
    public void clearSession(String sessionId) {
        sessions.remove(sessionId);
        log.debug("Cleared session: {}", sessionId);
    }

    /**
     * 清理超过指定时间的已完成会话
     *
     * @param maxAgeMillis 最大保留时间（毫秒）
     */
    public void cleanupOldSessions(long maxAgeMillis) {
        long now = System.currentTimeMillis();
        sessions.entrySet().removeIf(entry -> {
            StreamSession session = entry.getValue();
            if (session.isFinished() && session.getEndTime() > 0) {
                boolean shouldRemove = (now - session.getEndTime()) > maxAgeMillis;
                if (shouldRemove) {
                    log.debug("Cleaning up old session: {}", entry.getKey());
                }
                return shouldRemove;
            }
            return false;
        });
    }

    /**
     * 流式会话数据
     */
    @Data
    public static class StreamSession {
        private String sessionId;
        private long startTime;
        private long endTime;
        private boolean finished;
        private boolean error;
        private String errorMessage;
        private CopyOnWriteArrayList<String> contentChunks = new CopyOnWriteArrayList<>();
        private Map<String, Object> metadata = new ConcurrentHashMap<>();
    }

    /**
     * 返回给前端的内容片段
     */
    @Data
    public static class StreamChunk {
        private String sessionId;
        private int offset;
        private int nextOffset;
        private String content;
        private boolean finished;
        private boolean error;
        private String errorMessage;
        private boolean notFound;
        private Map<String, Object> metadata;

        public static StreamChunk notFound() {
            StreamChunk chunk = new StreamChunk();
            chunk.setNotFound(true);
            return chunk;
        }
    }
}

package ai.dat.agent.agentic;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.utils.ContentStoreUtil;
import ai.dat.core.contentstore.utils.ContentStoreUtil;
import com.google.common.base.Preconditions;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.input.PromptTemplate;
import dev.langchain4j.rag.content.Content;
import dev.langchain4j.rag.content.injector.ContentInjector;
import lombok.NonNull;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/8/11
 */
class DataAssistanceContentInjector implements ContentInjector {

    private static final PromptTemplate PROMPT_TEMPLATE;

    static {
        PROMPT_TEMPLATE = PromptTemplate.from(loadText("prompts/agentic/data_assistance_user_prompt.txt"));
    }

    private static String loadText(String fromResource) {
        try (InputStream inputStream = DataAssistanceContentInjector.class.getClassLoader()
                .getResourceAsStream(fromResource)) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to load text from resources: " + fromResource, e);
        }
    }

    private final ContentStore contentStore;
    private final DatabaseAdapter databaseAdapter;

    public DataAssistanceContentInjector(@NonNull ContentStore contentStore,
                                         @NonNull DatabaseAdapter databaseAdapter) {
        this.contentStore = contentStore;
        this.databaseAdapter = databaseAdapter;
    }


    @Override
    public ChatMessage inject(List<Content> contents, ChatMessage chatMessage) {
        if (contents.isEmpty()) {
            return chatMessage;
        } else {
            List<String> semantics = contents.stream()
                    .map(Content::textSegment)
                    .filter(ts -> "light_schema".equals(ts.metadata().getString("content_type")))
                    .map(TextSegment::text)
                    .collect(Collectors.toList());

            String query = ((dev.langchain4j.data.message.UserMessage) chatMessage).singleText();

            Map<String, Object> variables = new HashMap<>();
            variables.put("semantic_models", semantics);
            variables.put("query", query);

            return PROMPT_TEMPLATE.apply(variables).toUserMessage();
        }
    }
}

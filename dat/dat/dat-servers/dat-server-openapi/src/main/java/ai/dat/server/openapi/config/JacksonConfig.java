package ai.dat.server.openapi.config;

import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalTimeSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.format.DateTimeFormatter;

/**
 * Jackson配置
 *
 * <p>日期时间统一序列化为数据库展示风格（无时区、无T分隔符）：
 * <ul>
 *   <li>LocalDateTime → {@code yyyy-MM-dd HH:mm:ss}</li>
 *   <li>LocalDate → {@code yyyy-MM-dd}</li>
 *   <li>LocalTime → {@code HH:mm:ss}</li>
 * </ul>
 *
 * <p>注意：查询结果中的日期时间值由各数据库适配器负责转换为 java.time 类型
 * （timestamp → LocalDateTime），java.sql.Timestamp/Date 不应到达序列化层。
 *
 * @Author JunjieM
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer dbStyleJacksonCustomizer() {
        return builder -> builder.serializers(
                new LocalDateTimeSerializer(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")),
                new LocalDateSerializer(DateTimeFormatter.ofPattern("yyyy-MM-dd")),
                new LocalTimeSerializer(DateTimeFormatter.ofPattern("HH:mm:ss")));
    }
}

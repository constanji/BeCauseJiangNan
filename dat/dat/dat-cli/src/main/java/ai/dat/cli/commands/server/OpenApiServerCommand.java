package ai.dat.cli.commands.server;

import ai.dat.boot.ProjectBuilder;
import ai.dat.cli.provider.VersionProvider;
import ai.dat.server.openapi.Application;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * Project OpenAPI Server commands
 * 支持文件模式和 MongoDB 模式
 * 
 * MongoDB 模式：projectId 在 API 请求中动态传入，服务器支持多项目
 * 文件模式：使用固定的项目路径（向后兼容）
 *
 * @Author JunjieM
 * @Date 2025/8/26
 */
@Command(
        name = "openapi",
        mixinStandardHelpOptions = true,
        versionProvider = VersionProvider.class,
        description = "Start DAT OpenAPI Server and Swagger UI"
)
@Slf4j
public class OpenApiServerCommand implements Callable<Integer> {

    // ===== MongoDB 模式参数 =====
    @Option(names = {"--mongodb"},
            description = "Enable MongoDB mode (projectId passed via API requests)")
    private boolean mongoMode;

    @Option(names = {"--mongo-uri"},
            description = "MongoDB connection URI",
            defaultValue = "mongodb://localhost:27017")
    private String mongoUri;

    @Option(names = {"--mongo-database"},
            description = "MongoDB database name",
            defaultValue = "dat")
    private String mongoDatabase;

    // ===== 文件模式参数 =====
    @Option(names = {"-p", "--project-path"},
            description = "Project path (file mode, default: current directory)")
    private String projectPath;

    // ===== 通用参数 =====
    @Option(names = {"-H", "--host"},
            description = "Server host (default: 0.0.0.0)",
            defaultValue = "0.0.0.0")
    private String host;

    @Option(names = {"-P", "--port"},
            description = "Server port (default: 8080)",
            defaultValue = "8080")
    private int port;

    @Option(names = {"-var", "--variable"},
            arity = "1..*",
            description = "Dynamic variable, key-value pairs in format key=value")
    private Map<String, Object> variables;

    @Override
    public Integer call() {
        try {
            if (mongoMode) {
                // MongoDB 模式
                System.out.println("🗄️ Mode: MongoDB");
                System.out.println("🔗 MongoDB URI: " + mongoUri);
                System.out.println("🗃️ Database: " + mongoDatabase);
                System.out.println("📋 ProjectId will be passed via API requests");
            } else {
                // 文件模式
                if (projectPath == null) {
                    projectPath = ".";
                }
                Path path = Paths.get(projectPath).toAbsolutePath();
                log.info("Start OpenAPI server with file mode: {}", path);
                System.out.println("📁 Mode: File");
                System.out.println("📁 Project path: " + path);
                System.out.println("🛠️ Dynamic variables: " + variables);

                // 文件模式下需要预构建项目
                ProjectBuilder builder = new ProjectBuilder(path);
                builder.build(variables);
            }

            System.out.println();
            System.out.println("🚀 Starting DAT OpenAPI Server...");
            System.out.println("🌐 Server Address: http://" + host + ":" + port);
            System.out.println();

            // 创建Spring应用
            SpringApplication app = new SpringApplication(Application.class);
            app.setBannerMode(Banner.Mode.OFF);

            List<String> argsList = new ArrayList<>() {{
                add("--spring.profiles.active=openapi");
                add("--server.port=" + port);
                add("--server.address=" + host);
            }};

            if (mongoMode) {
                // MongoDB 模式参数
                argsList.add("--dat.server.mode=mongodb");
                argsList.add("--spring.data.mongodb.uri=" + mongoUri);
                argsList.add("--spring.data.mongodb.database=" + mongoDatabase);
            } else {
                // 文件模式参数
                argsList.add("--dat.server.mode=file");
                argsList.add("--dat.server.project-path=" + projectPath);
                if (variables != null && !variables.isEmpty()) {
                    variables.forEach((k, v) -> argsList.add("--dat.server.variables." + k + "=" + v));
                }
            }

            String[] args = argsList.toArray(new String[0]);

            // 运行Spring Boot应用
            try {
                ConfigurableApplicationContext context = app.run(args);
                addShutdownHook(context);

                if (context.isActive()) {
                    System.out.println("✅ Server started successfully!");
                    printUrls();

                    context.registerShutdownHook();

                    while (context.isActive()) {
                        try {
                            Thread.sleep(5000);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    }
                } else {
                    System.err.println("❌ Server failed to start properly");
                    return 1;
                }
            } catch (Exception e) {
                log.error("Failed to start OpenAPI server", e);
                System.err.println("❌ Failed to start server: " + e.getMessage());
                return 1;
            }

            System.out.println("Server stopped.");

            return 0;
        } catch (Exception e) {
            log.error("Failed to start server", e);
            System.err.println("❌ Failed to start server: " + e.getMessage());
            return 1;
        }
    }

    private void printUrls() {
        String baseUrl = "http://" + host + ":" + port;
        System.out.println("📖 Swagger UI: " + baseUrl + "/swagger-ui/index.html");
        System.out.println("📄 API Docs:   " + baseUrl + "/v3/api-docs");
        System.out.println("🏥 Health:     " + baseUrl + "/api/v1/health");
        System.out.println();
        System.out.println("Press Ctrl+C to stop");
    }

    private void addShutdownHook(ConfigurableApplicationContext context) {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("\n🛑 Stopping server...");
            context.close();
        }));
    }
}

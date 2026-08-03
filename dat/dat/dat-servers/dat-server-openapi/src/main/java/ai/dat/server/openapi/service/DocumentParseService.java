package ai.dat.server.openapi.service;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.DocumentParser;
import dev.langchain4j.data.document.parser.TextDocumentParser;
import dev.langchain4j.data.document.parser.apache.pdfbox.ApachePdfBoxDocumentParser;
import dev.langchain4j.data.document.parser.apache.poi.ApachePoiDocumentParser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Set;

/**
 * 文档解析服务
 * 支持解析 TXT, MD, PDF, DOC, DOCX 等格式
 *
 * @Author DAT Team
 * @Date 2025/12/31
 */
@Slf4j
@Service
public class DocumentParseService {

    // 文本格式（使用 TextDocumentParser）
    private static final Set<String> TEXT_EXTENSIONS = Set.of("txt", "md", "markdown", "html", "htm", "xml", "json", "csv");
    
    // PDF 格式
    private static final Set<String> PDF_EXTENSIONS = Set.of("pdf");
    
    // Office 格式（使用 ApachePoiDocumentParser）
    private static final Set<String> OFFICE_EXTENSIONS = Set.of("doc", "docx", "ppt", "pptx", "xls", "xlsx");

    private final TextDocumentParser textParser = new TextDocumentParser();
    private final ApachePdfBoxDocumentParser pdfParser = new ApachePdfBoxDocumentParser();
    private final ApachePoiDocumentParser poiParser = new ApachePoiDocumentParser();

    /**
     * 解析上传的文件，返回文档内容
     *
     * @param file 上传的文件
     * @return 解析后的文本内容
     */
    public String parseFile(MultipartFile file) throws IOException {
        String filename = file.getOriginalFilename();
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("文件名不能为空");
        }

        String extension = getFileExtension(filename).toLowerCase();
        log.info("Parsing file: {} with extension: {}", filename, extension);

        DocumentParser parser = getParserForExtension(extension);
        if (parser == null) {
            throw new IllegalArgumentException("不支持的文件格式: " + extension);
        }

        try (InputStream inputStream = file.getInputStream()) {
            Document document = parser.parse(inputStream);
            String content = document.text();
            log.info("Successfully parsed file: {}, content length: {}", filename, content.length());
            return content;
        }
    }

    /**
     * 检查文件格式是否支持
     */
    public boolean isSupported(String filename) {
        String extension = getFileExtension(filename).toLowerCase();
        return TEXT_EXTENSIONS.contains(extension) 
                || PDF_EXTENSIONS.contains(extension) 
                || OFFICE_EXTENSIONS.contains(extension);
    }

    /**
     * 获取支持的文件扩展名列表
     */
    public List<String> getSupportedExtensions() {
        return List.of("txt", "md", "pdf", "doc", "docx", "html", "xml", "json", "csv", "ppt", "pptx", "xls", "xlsx");
    }

    /**
     * 根据扩展名获取对应的解析器
     */
    private DocumentParser getParserForExtension(String extension) {
        if (TEXT_EXTENSIONS.contains(extension)) {
            return textParser;
        } else if (PDF_EXTENSIONS.contains(extension)) {
            return pdfParser;
        } else if (OFFICE_EXTENSIONS.contains(extension)) {
            return poiParser;
        }
        return null;
    }

    /**
     * 获取文件扩展名
     */
    private String getFileExtension(String filename) {
        int lastDot = filename.lastIndexOf('.');
        if (lastDot == -1 || lastDot == filename.length() - 1) {
            return "";
        }
        return filename.substring(lastDot + 1);
    }
}

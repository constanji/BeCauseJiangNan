package ai.dat.core.index.resolver;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.Comparator;
import java.util.List;

/**
 * 币种检测器(轻量规则,识别失败兜底 CN(折人民币))。
 * <p>线上币种维护在 c_par_crcy 表,共 19 种。这里以静态常量维护,
 * 不需要独立存储层。
 * <p>检测策略: 扫描问题文本,匹配币种名称或其常用别名,返回对应的
 * {@code currencyCode}。未匹配到任何币种时默认返回折人民币(CN)。
 *
 * @Author DAT Team
 * @Date 2026/6/23
 */
public class CurrencyDetector {

    @Getter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Match {
        private String currencyCode;
        private String currencyName;

        public static Match of(String code, String name) {
            return Match.builder().currencyCode(code).currencyName(name).build();
        }

        /** 默认: 折人民币 */
        public static Match def() {
            return Match.builder().currencyCode("CN").currencyName("折人民币").build();
        }
    }

    /** 币种条目(code, 正式名, 常用别名)。按名称长度降序排列,避免短名误匹配。 */
    private static final List<CurrencyEntry> ENTRIES = List.of(
            entry("01", "人民币",  "人民币", "RMB", "CNY"),
            entry("CN", "折人民币", "折人民币"),
            entry("FC", "外币折人民币", "外币折人民币"),
            entry("US", "外币折美元", "外币折美元"),
            entry("12", "英镑",    "英镑", "GBP"),
            entry("13", "香港元",  "香港元", "港币", "港元", "HKD"),
            entry("14", "美元",    "美元", "美金", "USD"),
            entry("15", "瑞士法郎", "瑞士法郎", "CHF"),
            entry("18", "新加坡元", "新加坡元", "新币", "SGD"),
            entry("27", "日元",    "日元", "日币", "JPY"),
            entry("28", "加元",    "加元", "加拿大元", "CAD"),
            entry("29", "澳大利亚元", "澳大利亚元", "澳元", "澳币", "AUD"),
            entry("32", "林吉特",  "林吉特", "MYR"),
            entry("36", "银",      "银"),
            entry("37", "伦敦金",  "伦敦金"),
            entry("38", "欧元",    "欧元", "EUR"),
            entry("40", "99金",   "99金"),
            entry("81", "澳门元",  "澳门元", "澳门币", "MOP"),
            entry("84", "泰铢",    "泰铢", "THB")
    );

    static {
        // 编译期校验: 19 种币种
        if (ENTRIES.size() != 19) {
            throw new AssertionError("币种数量应为 19，实际: " + ENTRIES.size());
        }
    }

    /** 按名称/别名长度降序排列,匹配时优先命中更长的(更具体的)名称。 */
    private static final List<CurrencyEntry> SORTED_ENTRIES = ENTRIES.stream()
            .sorted(Comparator.comparingInt((CurrencyEntry e) -> e.maxLen()).reversed())
            .toList();

    private record CurrencyEntry(String code, String name, List<String> aliases) {
        int maxLen() {
            return aliases.stream().mapToInt(String::length).max().orElse(0);
        }

        boolean matches(String text) {
            for (String alias : aliases) {
                if (text.contains(alias)) {
                    return true;
                }
            }
            return false;
        }
    }

    private static CurrencyEntry entry(String code, String name, String... aliases) {
        return new CurrencyEntry(code, name, List.of(aliases));
    }

    /**
     * 检测问题中是否提到了某个币种。
     *
     * @return 匹配到的币种信息;未匹配到返回默认(CN, 折人民币)
     */
    public Match detect(String question) {
        if (question == null || question.isBlank()) {
            return Match.def();
        }
        for (CurrencyEntry entry : SORTED_ENTRIES) {
            if (entry.matches(question)) {
                return Match.of(entry.code(), entry.name());
            }
        }
        return Match.def();
    }

    /** 全量币种列表(供 prompt 使用)。 */
    public List<Match> allCurrencies() {
        return ENTRIES.stream()
                .map(e -> Match.of(e.code(), e.name()))
                .toList();
    }
}

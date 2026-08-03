package ai.dat.core.index.resolver;

import ai.dat.core.index.data.DateScenario;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 中文日期场景识别器(轻量规则,识别失败兜底 NONE)。
 * <p>识别优先级(从精确到模糊):
 * <ol>
 *   <li>显式范围(关键词:到/至/-) → BETWEEN</li>
 *   <li>季度/上下半年/全年 → BETWEEN</li>
 *   <li>近N个月(近/最近/过去 + 数字) → IN(月末日期列表)</li>
 *   <li>多月枚举(逗号/顿号/和 分隔的多个 X月,支持跨年) → IN</li>
 *   <li>多个完整日期(逗号/顿号/和 分隔)→ IN</li>
 *   <li>单个完整日期 → EQ</li>
 *   <li>都不匹配 → NONE</li>
 * </ol>
 *
 * <p>"今天/昨天/上周"等相对日期已支持;"近N个月"返回 IN(月末日期列表)。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public class DateScenarioDetector {

    // ─── 正则:完整日期(yyyy-mm-dd / yyyy/m/d / yyyy年m月d日) ──────────────
    private static final Pattern DATE_DASH = Pattern.compile(
            "(?<y>\\d{4})[-/](?<m>\\d{1,2})[-/](?<d>\\d{1,2})");
    private static final Pattern DATE_CHN = Pattern.compile(
            "(?<y>\\d{4})年(?<m>\\d{1,2})月(?<d>\\d{1,2})[日号]");

    // ─── 范围标记词 ──────────────────────────────────────────────────────
    private static final Pattern RANGE_KEYWORD = Pattern.compile("到|至|~|—|--|–");

    // ─── 月份枚举(X月) ──────────────────────────────────────────────────
    private static final Pattern MONTH_TOKEN = Pattern.compile("(?<m>\\d{1,2})月");

    // ─── 年份(用于"X年"全年范围识别) ───────────────────────────────────
    private static final Pattern YEAR_FULL = Pattern.compile("(?<y>\\d{4})年");

    // ─── 季度/半年 ───────────────────────────────────────────────────────
    private static final Pattern QUARTER = Pattern.compile(
            "(?<y>\\d{4})?年?(?:第)?(?<q>[一二三四1234])季度");
    private static final Pattern HALF_YEAR = Pattern.compile(
            "(?<y>\\d{4})?年?(?<h>上半年|下半年)");

    // ─── 相对日期(上月/去年/昨天/上旬等) ──────────────────────────────
    private static final Pattern RELATIVE_MONTH = Pattern.compile("上个月|上月");
    private static final Pattern RELATIVE_YEAR = Pattern.compile("去年|上年");
    private static final Pattern RELATIVE_QUARTER = Pattern.compile("上季度|上季");
    private static final Pattern CUR_MONTH = Pattern.compile("本月|这个月");
    private static final Pattern CUR_YEAR = Pattern.compile("今年|本年");
    private static final Pattern CUR_QUARTER = Pattern.compile("本季度|本季|这个季度");

    // ─── 相对日 ──────────────────────────────────────────────────────────
    private static final Pattern YESTERDAY = Pattern.compile("昨天|昨日");
    private static final Pattern TODAY = Pattern.compile("今天|今日");
    private static final Pattern DAY_BEFORE_YESTERDAY = Pattern.compile("前天|前日");

    // ─── 相对旬 ──────────────────────────────────────────────────────────
    private static final Pattern XUN_UPPER = Pattern.compile("上旬");    // 1-10
    private static final Pattern XUN_MID = Pattern.compile("中旬");      // 11-20
    private static final Pattern XUN_LOWER = Pattern.compile("下旬");    // 21-月末
    // X月上旬 (带月份)
    private static final Pattern MONTH_XUN = Pattern.compile(
            "(?<m>\\d{1,2})月(?<x>上旬|中旬|下旬)");

    // ─── 近N个月 ──────────────────────────────────────────────────────────
    private static final Pattern RECENT_MONTHS = Pattern.compile(
            "(?:近|最近|过去)(?<n>[一二三四五六七八九十\\d]+)个?月");

    // ─── 相对周 ──────────────────────────────────────────────────────────
    private static final Pattern LAST_WEEK = Pattern.compile("上周|上星期|上个星期");
    private static final Pattern THIS_WEEK = Pattern.compile("本周|这周|这个星期|这个周");

    private static final DateTimeFormatter DT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 检测结果。 */
    @Getter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Result {
        @Builder.Default
        private DateScenario scenario = DateScenario.NONE;
        /** EQ/IN 用,yyyy-MM-dd。 */
        @Builder.Default
        private List<String> values = Collections.emptyList();
        /** BETWEEN 起点(yyyy-MM-dd HH:mm:ss)。 */
        private String start;
        /** BETWEEN 终点(yyyy-MM-dd HH:mm:ss)。 */
        private String end;

        public static Result none() {
            return Result.builder().scenario(DateScenario.NONE).build();
        }
    }

    /** 主入口。 */
    public Result detect(String question) {
        if (question == null || question.isBlank()) {
            return Result.none();
        }
        // 1) 显式日期范围:出现"到/至/-"且左右都能匹配出完整日期
        Result rng = detectExplicitRange(question);
        if (rng != null) return rng;

        // 2) 季度 / 上下半年 / 全年
        Result period = detectPeriodKeywords(question);
        if (period != null) return period;

        // 2.5) 相对日期:上月/去年/上季度/本月/今年/本季度 → BETWEEN
        Result relative = detectRelativeDate(question);
        if (relative != null) return relative;

        // 3) 多个完整日期(IN)
        List<String> dates = extractAllDates(question);
        if (dates.size() >= 2) {
            return Result.builder().scenario(DateScenario.IN).values(dates).build();
        }
        // 4) 单日(EQ)
        if (dates.size() == 1) {
            return Result.builder().scenario(DateScenario.EQ).values(dates).build();
        }
        // 5) 多月枚举(IN,取每月月末)
        Result months = detectMonthEnumeration(question);
        if (months != null) return months;

        return Result.none();
    }

    // ─── 1) 显式日期范围 ─────────────────────────────────────────────────

    private Result detectExplicitRange(String q) {
        if (!RANGE_KEYWORD.matcher(q).find()) {
            return null;
        }
        List<String> dates = extractAllDates(q);
        if (dates.size() != 2) {
            return null;   // 不够明确,交给后续规则
        }
        String a = dates.get(0);
        String b = dates.get(1);
        LocalDate da = LocalDate.parse(a);
        LocalDate db = LocalDate.parse(b);
        if (da.isAfter(db)) {
            LocalDate tmp = da; da = db; db = tmp;
        }
        return Result.builder()
                .scenario(DateScenario.BETWEEN)
                .start(da.atStartOfDay().format(DT))
                .end(db.atTime(23, 59, 59).format(DT))
                .build();
    }

    // ─── 2) 季度 / 半年 ──────────────────────────────────────────────────

    private Result detectPeriodKeywords(String q) {
        // 季度
        Matcher m = QUARTER.matcher(q);
        if (m.find()) {
            int year = m.group("y") != null ? Integer.parseInt(m.group("y")) : currentYear();
            int quarter = parseQuarter(m.group("q"));
            LocalDate start = LocalDate.of(year, (quarter - 1) * 3 + 1, 1);
            LocalDate end = start.plusMonths(3).minusDays(1);
            return between(start, end);
        }
        // 上半年/下半年
        m = HALF_YEAR.matcher(q);
        if (m.find()) {
            int year = m.group("y") != null ? Integer.parseInt(m.group("y")) : currentYear();
            String h = m.group("h");
            if ("上半年".equals(h)) {
                return between(LocalDate.of(year, 1, 1), LocalDate.of(year, 6, 30));
            } else {
                return between(LocalDate.of(year, 7, 1), LocalDate.of(year, 12, 31));
            }
        }
        // 全年(纯"YYYY年"且没附加月/季关键词)
        Matcher y = YEAR_FULL.matcher(q);
        if (y.find()) {
            // 检查是否同时出现"月/季度/半年"等其他周期词,有就让后续规则处理
            String remainder = q.replace(y.group(0), "");
            if (!remainder.contains("月") && !remainder.contains("季度") && !remainder.contains("半年")) {
                int year = Integer.parseInt(y.group("y"));
                return between(LocalDate.of(year, 1, 1), LocalDate.of(year, 12, 31));
            }
        }
        return null;
    }

    // ─── 2.5) 相对日期检测 ────────────────────────────────────────────────

    private Result detectRelativeDate(String q) {
        LocalDate today = LocalDate.now();

        // 上个月 / 上月 → 上月整月
        if (RELATIVE_MONTH.matcher(q).find()) {
            YearMonth lastMonth = YearMonth.from(today).minusMonths(1);
            return between(lastMonth.atDay(1), lastMonth.atEndOfMonth());
        }
        // 去年 / 上年 → 去年整年
        if (RELATIVE_YEAR.matcher(q).find()) {
            int year = today.getYear() - 1;
            return between(LocalDate.of(year, 1, 1), LocalDate.of(year, 12, 31));
        }
        // 上季度 / 上季 → 上季度
        if (RELATIVE_QUARTER.matcher(q).find()) {
            int currentQ = (today.getMonthValue() - 1) / 3 + 1;
            int lastQ = currentQ - 1;
            int year = today.getYear();
            if (lastQ == 0) {
                lastQ = 4;
                year--;
            }
            return betweenQuarter(year, lastQ);
        }
        // 本月 / 这个月 → 本月整月
        if (CUR_MONTH.matcher(q).find()) {
            YearMonth curMonth = YearMonth.from(today);
            return between(curMonth.atDay(1), curMonth.atEndOfMonth());
        }
        // 今年 / 本年 → 今年整年
        if (CUR_YEAR.matcher(q).find()) {
            return between(LocalDate.of(today.getYear(), 1, 1),
                    LocalDate.of(today.getYear(), 12, 31));
        }
        // 本季度 / 本季 / 这个季度 → 本季度
        if (CUR_QUARTER.matcher(q).find()) {
            int quarterNum = (today.getMonthValue() - 1) / 3 + 1;
            return betweenQuarter(today.getYear(), quarterNum);
        }
        // ─── 相对日 ────────────────────────────────────────────────────
        // 昨天 / 昨日
        if (YESTERDAY.matcher(q).find()) {
            LocalDate d = today.minusDays(1);
            return between(d, d);
        }
        // 前天 / 前日
        if (DAY_BEFORE_YESTERDAY.matcher(q).find()) {
            LocalDate d = today.minusDays(2);
            return between(d, d);
        }
        // 今天 / 今日
        if (TODAY.matcher(q).find()) {
            return between(today, today);
        }
        // ─── 相对旬 ────────────────────────────────────────────────────
        // X月上旬 / X月中旬 / X月下旬
        Matcher mx = MONTH_XUN.matcher(q);
        if (mx.find()) {
            int month = Integer.parseInt(mx.group("m"));
            String xun = mx.group("x");
            return betweenXun(today.getYear(), month, xun);
        }
        // 上旬 / 中旬 / 下旬(无月份,默认当月)
        if (XUN_UPPER.matcher(q).find()) {
            return betweenXun(today.getYear(), today.getMonthValue(), "上旬");
        }
        if (XUN_MID.matcher(q).find()) {
            return betweenXun(today.getYear(), today.getMonthValue(), "中旬");
        }
        if (XUN_LOWER.matcher(q).find()) {
            return betweenXun(today.getYear(), today.getMonthValue(), "下旬");
        }
        // ─── 近N个月(月末日期列表) ─────────────────────────────────────
        Matcher rm = RECENT_MONTHS.matcher(q);
        if (rm.find()) {
            Integer n = parseChineseOrArabicNumber(rm.group("n"));
            if (n != null && n >= 1 && n <= 36) {
                List<String> values = new ArrayList<>();
                YearMonth current = YearMonth.from(today);
                for (int i = 1; i <= n; i++) {
                    YearMonth ym = current.minusMonths(i);
                    values.add(ym.atEndOfMonth().toString());
                }
                Collections.sort(values);
                return Result.builder().scenario(DateScenario.IN).values(values).build();
            }
        }
        // ─── 相对周 ────────────────────────────────────────────────────
        // 上周 / 上星期
        if (LAST_WEEK.matcher(q).find()) {
            // 上周一 ~ 上周日
            LocalDate lastMon = today.minusDays(today.getDayOfWeek().getValue() + 6);
            return between(lastMon, lastMon.plusDays(6));
        }
        // 本周 / 这周
        if (THIS_WEEK.matcher(q).find()) {
            LocalDate thisMon = today.minusDays(today.getDayOfWeek().getValue() - 1);
            return between(thisMon, thisMon.plusDays(6));
        }
        return null;
    }

    /** 根据年份和季度编号(1-4)构造 BETWEEN 结果。 */
    private Result betweenQuarter(int year, int quarter) {
        LocalDate start = LocalDate.of(year, (quarter - 1) * 3 + 1, 1);
        LocalDate end = start.plusMonths(3).minusDays(1);
        return between(start, end);
    }

    /** 根据年月和旬(上旬/中旬/下旬)构造 BETWEEN 结果。 */
    private Result betweenXun(int year, int month, String xun) {
        LocalDate start;
        LocalDate end;
        switch (xun) {
            case "上旬":
                start = LocalDate.of(year, month, 1);
                end = LocalDate.of(year, month, 10);
                break;
            case "中旬":
                start = LocalDate.of(year, month, 11);
                end = LocalDate.of(year, month, 20);
                break;
            case "下旬":
                start = LocalDate.of(year, month, 21);
                end = LocalDate.of(year, month,
                        YearMonth.of(year, month).lengthOfMonth());
                break;
            default:
                return null;
        }
        return between(start, end);
    }

    private static int parseQuarter(String s) {
        return switch (s) {
            case "一", "1" -> 1;
            case "二", "2" -> 2;
            case "三", "3" -> 3;
            case "四", "4" -> 4;
            default -> 1;
        };
    }

    /** 解析中文数字或阿拉伯数字（1~36 范围）。 */
    private static Integer parseChineseOrArabicNumber(String raw) {
        if (raw == null || raw.isBlank()) return null;
        // 先尝试阿拉伯数字
        if (raw.matches("\\d+")) {
            try { return Integer.parseInt(raw); } catch (NumberFormatException e) { return null; }
        }
        // 中文数字
        return switch (raw) {
            case "一" -> 1;  case "二" -> 2;  case "三" -> 3;
            case "四" -> 4;  case "五" -> 5;  case "六" -> 6;
            case "七" -> 7;  case "八" -> 8;  case "九" -> 9;
            case "十" -> 10;
            case "十一" -> 11; case "十二" -> 12;
            default -> null;
        };
    }

    private Result between(LocalDate start, LocalDate end) {
        return Result.builder()
                .scenario(DateScenario.BETWEEN)
                .start(start.atStartOfDay().format(DT))
                .end(end.atTime(23, 59, 59).format(DT))
                .build();
    }

    // ─── 3) 完整日期提取(保序去重) ─────────────────────────────────────

    private List<String> extractAllDates(String q) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        Matcher m = DATE_DASH.matcher(q);
        while (m.find()) {
            addNormalized(out, m.group("y"), m.group("m"), m.group("d"));
        }
        m = DATE_CHN.matcher(q);
        while (m.find()) {
            addNormalized(out, m.group("y"), m.group("m"), m.group("d"));
        }
        return new ArrayList<>(out);
    }

    private void addNormalized(LinkedHashSet<String> out, String y, String mm, String dd) {
        try {
            LocalDate d = LocalDate.of(Integer.parseInt(y), Integer.parseInt(mm), Integer.parseInt(dd));
            out.add(d.toString());
        } catch (NumberFormatException | DateTimeParseException ignore) {
        }
    }

    // ─── 5) 多月枚举(取月末,支持跨年) ─────────────────────────────────

    // 带年份前缀的月份: "2025年12月" / "2026年1月"
    private static final Pattern YEAR_MONTH_TOKEN = Pattern.compile(
            "(?<y>\\d{4})年(?<m>\\d{1,2})月");
    // 不带年份前缀的月份: "1月" / "2月"（前面不能紧跟4位数字年份）
    private static final Pattern BARE_MONTH_TOKEN = Pattern.compile(
            "(?<!\\d{4}年)(?<m>\\d{1,2})月");

    private Result detectMonthEnumeration(String q) {
        // 按出现顺序收集(年份, 月份)对,支持 "2025年12月、2026年1月、2月、3月" 这种混合写法
        List<int[]> yearMonthPairs = new ArrayList<>();

        // 第一遍：收集所有带年份的 "YYYY年M月" 及其位置
        Matcher ym = YEAR_MONTH_TOKEN.matcher(q);
        java.util.TreeMap<Integer, int[]> posMap = new java.util.TreeMap<>();
        while (ym.find()) {
            int month = Integer.parseInt(ym.group("m"));
            if (month >= 1 && month <= 12) {
                posMap.put(ym.start(), new int[]{Integer.parseInt(ym.group("y")), month});
            }
        }

        // 第二遍：收集不带年份的 "M月" 及其位置
        Matcher bm = BARE_MONTH_TOKEN.matcher(q);
        while (bm.find()) {
            int month = Integer.parseInt(bm.group("m"));
            if (month >= 1 && month <= 12) {
                // 只在该位置没有被 YEAR_MONTH_TOKEN 覆盖时才加入
                int pos = bm.start();
                boolean coveredByYearMonth = posMap.entrySet().stream()
                        .anyMatch(e -> pos >= e.getKey() && pos < e.getKey() + 10);
                if (!coveredByYearMonth) {
                    posMap.put(pos, new int[]{-1, month}); // -1 表示需要推断年份
                }
            }
        }

        if (posMap.size() < 2) {
            return null;
        }

        // 推断缺失的年份：
        // - 有年份前缀的直接用
        // - 没有年份前缀的，向前找最近一个有年份的月份，如果当前月份 <= 前一个月份则年份 +1（回绕）
        // - 如果前面没有任何年份，用问题中出现的第一个"YYYY年"或默认当前年
        Integer defaultYear = null;
        Matcher yy = YEAR_FULL.matcher(q);
        if (yy.find()) {
            defaultYear = Integer.parseInt(yy.group("y"));
        }
        if (defaultYear == null) {
            defaultYear = currentYear();
        }

        int lastKnownYear = defaultYear;
        int lastMonth = -1;
        for (int[] pair : posMap.values()) {
            int year = pair[0];
            int month = pair[1];
            if (year == -1) {
                // 推断年份：如果月份回绕（如从12到1），年份 +1
                if (lastMonth != -1 && month <= lastMonth && lastMonth - month >= 6) {
                    lastKnownYear++;
                }
                year = lastKnownYear;
            } else {
                lastKnownYear = year;
            }
            yearMonthPairs.add(new int[]{year, month});
            lastMonth = month;
        }

        // 去重并生成月末日期
        LinkedHashSet<String> values = new LinkedHashSet<>();
        for (int[] pair : yearMonthPairs) {
            values.add(YearMonth.of(pair[0], pair[1]).atEndOfMonth().toString());
        }
        if (values.size() < 2) {
            return null;
        }
        return Result.builder().scenario(DateScenario.IN).values(new ArrayList<>(values)).build();
    }

    /** 当前年份。抽成方法便于测试覆盖。 */
    protected int currentYear() {
        return LocalDate.now().getYear();
    }
}

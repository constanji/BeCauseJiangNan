package ai.dat.core.index.resolver;

import ai.dat.core.index.data.DateIntent;
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
import java.util.List;

/**
 * 把 LLM 返回的抽象 {@link DateIntent} 展开成具体的 {@link DateScenario} + 日期值。
 *
 * <p>笛卡尔展开规则 (anchor × granularity):
 * <pre>
 *   anchorType=NONE                              → DateScenario.NONE
 *   anchorType=EXACT,    granularity=NONE        → EQ(exact_date)
 *   anchorType=EXACT,    granularity=MONTH_END   → EQ(月末)
 *   anchorType=LIST,     granularity=NONE        → IN(list_dates)
 *   anchorType=LIST,     granularity=MONTH_END   → IN(每个月末)
 *   anchorType=RANGE,    granularity=NONE        → BETWEEN(range)
 *   anchorType=RANGE,    granularity=MONTH_END   → IN(区间内每个月末)
 *   anchorType=RANGE,    granularity=QUARTER_END → IN(区间内每个季末)
 *   anchorType=RELATIVE_WINDOW, granularity=NONE       → BETWEEN(今天往前推 N 个 unit)
 *   anchorType=RELATIVE_WINDOW, granularity=MONTH_END  → IN(近N个月末)
 * </pre>
 *
 * @Author DAT Team
 * @Date 2026/6/24
 */
public class DateIntentExpander {

    private static final DateTimeFormatter DT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter D_DASH = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    @Getter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Result {
        @Builder.Default
        private DateScenario scenario = DateScenario.NONE;
        @Builder.Default
        private List<String> values = Collections.emptyList();
        private String start;
        private String end;

        public static Result none() {
            return Result.builder().scenario(DateScenario.NONE).build();
        }
    }

    /** 入口 */
    public Result expand(DateIntent intent) {
        if (intent == null || intent.getAnchorType() == null || intent.getAnchorType() == DateIntent.AnchorType.NONE) {
            return Result.none();
        }

        DateIntent.AnchorType anchor = intent.getAnchorType();
        DateIntent.Granularity gran = intent.getGranularity() == null ? DateIntent.Granularity.NONE : intent.getGranularity();

        switch (anchor) {
            case EXACT:
                return expandExact(intent, gran);
            case LIST:
                return expandList(intent, gran);
            case RANGE:
                return expandRange(intent, gran);
            case RELATIVE_WINDOW:
                return expandWindow(intent, gran);
            default:
                return Result.none();
        }
    }

    // ─── EXACT ───────────────────────────────────────────────────────────

    private Result expandExact(DateIntent intent, DateIntent.Granularity gran) {
        String raw = intent.getExactDate();
        LocalDate d = parseDate(raw);
        if (d == null) return Result.none();
        LocalDate snapped = snap(d, gran);
        return Result.builder()
                .scenario(DateScenario.EQ)
                .values(List.of(snapped.toString()))
                .build();
    }

    // ─── LIST ────────────────────────────────────────────────────────────

    private Result expandList(DateIntent intent, DateIntent.Granularity gran) {
        if (intent.getListDates() == null || intent.getListDates().isEmpty()) {
            return Result.none();
        }
        List<String> out = new ArrayList<>();
        for (String raw : intent.getListDates()) {
            // 支持 "yyyy-MM" 和 "yyyy-MM-dd"
            LocalDate d = parseDateOrYearMonth(raw, gran);
            if (d != null) {
                out.add(snap(d, gran).toString());
            }
        }
        if (out.isEmpty()) return Result.none();
        return Result.builder().scenario(DateScenario.IN).values(out).build();
    }

    // ─── RANGE ───────────────────────────────────────────────────────────

    private Result expandRange(DateIntent intent, DateIntent.Granularity gran) {
        LocalDate s = parseDate(intent.getRangeStart());
        LocalDate e = parseDate(intent.getRangeEnd());
        if (s == null || e == null) return Result.none();
        if (s.isAfter(e)) {
            LocalDate tmp = s; s = e; e = tmp;
        }
        // 无粒度 → 直接 BETWEEN
        if (gran == DateIntent.Granularity.NONE || gran == DateIntent.Granularity.DAILY) {
            return Result.builder()
                    .scenario(DateScenario.BETWEEN)
                    .start(s.atStartOfDay().format(DT))
                    .end(e.atTime(23, 59, 59).format(DT))
                    .build();
        }
        // 有粒度 → 在区间内枚举出每个时间点 → IN
        List<String> points = enumeratePoints(s, e, gran);
        if (points.isEmpty()) return Result.none();
        return Result.builder().scenario(DateScenario.IN).values(points).build();
    }

    // ─── RELATIVE_WINDOW ─────────────────────────────────────────────────

    private Result expandWindow(DateIntent intent, DateIntent.Granularity gran) {
        if (intent.getWindowUnit() == null || intent.getWindowCount() == null || intent.getWindowCount() <= 0) {
            return Result.none();
        }
        LocalDate today = LocalDate.now();
        int n = intent.getWindowCount();
        DateIntent.WindowUnit unit = intent.getWindowUnit();

        // 计算窗口起止
        LocalDate windowStart;
        LocalDate windowEnd = today;
        switch (unit) {
            case day:
                windowStart = today.minusDays(n - 1L);
                break;
            case month:
                windowStart = today.minusMonths(n);
                // 近N个月默认从上月末往前推；窗口结束设为上月末
                windowEnd = YearMonth.from(today).minusMonths(1).atEndOfMonth();
                windowStart = YearMonth.from(windowEnd).minusMonths(n - 1L).atDay(1);
                break;
            case quarter:
                windowStart = today.minusMonths(n * 3L);
                break;
            case year:
                windowStart = today.minusYears(n);
                break;
            default:
                return Result.none();
        }

        // 无粒度且 unit=month → 默认按月末展开(用户说"近五个月"通常意指月末点而非日级 BETWEEN)
        if (gran == DateIntent.Granularity.NONE && unit == DateIntent.WindowUnit.month) {
            gran = DateIntent.Granularity.MONTH_END;
        }
        // 无粒度且 unit=quarter → 默认季末
        if (gran == DateIntent.Granularity.NONE && unit == DateIntent.WindowUnit.quarter) {
            gran = DateIntent.Granularity.QUARTER_END;
        }
        // 其余 NONE/DAILY → BETWEEN
        if (gran == DateIntent.Granularity.NONE || gran == DateIntent.Granularity.DAILY) {
            return Result.builder()
                    .scenario(DateScenario.BETWEEN)
                    .start(windowStart.atStartOfDay().format(DT))
                    .end(windowEnd.atTime(23, 59, 59).format(DT))
                    .build();
        }
        List<String> points = enumeratePoints(windowStart, windowEnd, gran);
        if (points.isEmpty()) return Result.none();
        return Result.builder().scenario(DateScenario.IN).values(points).build();
    }

    // ─── 区间内按粒度枚举时间点 ─────────────────────────────────────────

    private List<String> enumeratePoints(LocalDate start, LocalDate end, DateIntent.Granularity gran) {
        List<String> out = new ArrayList<>();
        switch (gran) {
            case MONTH_END: {
                YearMonth ym = YearMonth.from(start);
                YearMonth endYm = YearMonth.from(end);
                while (!ym.isAfter(endYm)) {
                    LocalDate me = ym.atEndOfMonth();
                    if (!me.isBefore(start) && !me.isAfter(end)) {
                        out.add(me.toString());
                    }
                    ym = ym.plusMonths(1);
                }
                break;
            }
            case QUARTER_END: {
                // 季末月: 3/6/9/12
                int[] qm = {3, 6, 9, 12};
                int y = start.getYear();
                while (y <= end.getYear()) {
                    for (int m : qm) {
                        LocalDate qe = YearMonth.of(y, m).atEndOfMonth();
                        if (!qe.isBefore(start) && !qe.isAfter(end)) {
                            out.add(qe.toString());
                        }
                    }
                    y++;
                }
                break;
            }
            case YEAR_END: {
                int y = start.getYear();
                while (y <= end.getYear()) {
                    LocalDate ye = LocalDate.of(y, 12, 31);
                    if (!ye.isBefore(start) && !ye.isAfter(end)) {
                        out.add(ye.toString());
                    }
                    y++;
                }
                break;
            }
            case TEN_DAY: {
                // 旬末: 10 / 20 / 月末
                YearMonth ym = YearMonth.from(start);
                YearMonth endYm = YearMonth.from(end);
                while (!ym.isAfter(endYm)) {
                    int last = ym.lengthOfMonth();
                    for (int d : new int[]{10, 20, last}) {
                        LocalDate dt = ym.atDay(d);
                        if (!dt.isBefore(start) && !dt.isAfter(end)) {
                            out.add(dt.toString());
                        }
                    }
                    ym = ym.plusMonths(1);
                }
                break;
            }
            case DAILY: {
                LocalDate cur = start;
                while (!cur.isAfter(end)) {
                    out.add(cur.toString());
                    cur = cur.plusDays(1);
                }
                break;
            }
            default:
        }
        return out;
    }

    // ─── 粒度对齐 (用于 EXACT / LIST 单点) ───────────────────────────────

    private LocalDate snap(LocalDate d, DateIntent.Granularity gran) {
        if (gran == null) return d;
        switch (gran) {
            case MONTH_END: return YearMonth.from(d).atEndOfMonth();
            case QUARTER_END: {
                int q = (d.getMonthValue() - 1) / 3;
                int qEndMonth = (q + 1) * 3;
                return YearMonth.of(d.getYear(), qEndMonth).atEndOfMonth();
            }
            case YEAR_END: return LocalDate.of(d.getYear(), 12, 31);
            default: return d;
        }
    }

    // ─── 日期解析(支持 yyyy-MM-dd / yyyy-M-d / yyyyMMdd) ─────────────────

    private LocalDate parseDate(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.trim();
        try {
            return LocalDate.parse(s, D_DASH);
        } catch (DateTimeParseException ignore) {}
        // yyyyMMdd
        if (s.matches("\\d{8}")) {
            try {
                return LocalDate.of(
                        Integer.parseInt(s.substring(0, 4)),
                        Integer.parseInt(s.substring(4, 6)),
                        Integer.parseInt(s.substring(6, 8)));
            } catch (Exception ignore) {}
        }
        // yyyy/M/d
        try {
            return LocalDate.parse(s.replace('/', '-'), D_DASH);
        } catch (DateTimeParseException ignore) {}
        // yyyy-MM-dd HH:mm:ss
        try {
            return LocalDate.parse(s.substring(0, 10), D_DASH);
        } catch (Exception ignore) {}
        return null;
    }

    private LocalDate parseDateOrYearMonth(String raw, DateIntent.Granularity gran) {
        if (raw == null || raw.isBlank()) return null;
        String s = raw.trim();
        // yyyy-MM
        if (s.matches("\\d{4}-\\d{1,2}")) {
            try {
                YearMonth ym = YearMonth.parse(s, DateTimeFormatter.ofPattern("yyyy-M"));
                // 当粒度是 MONTH_END/NONE 都按月末处理；DAILY 则取月初
                if (gran == DateIntent.Granularity.DAILY) {
                    return ym.atDay(1);
                }
                return ym.atEndOfMonth();
            } catch (DateTimeParseException ignore) {}
        }
        // yyyyMM
        if (s.matches("\\d{6}")) {
            try {
                YearMonth ym = YearMonth.of(
                        Integer.parseInt(s.substring(0, 4)),
                        Integer.parseInt(s.substring(4, 6)));
                return gran == DateIntent.Granularity.DAILY ? ym.atDay(1) : ym.atEndOfMonth();
            } catch (Exception ignore) {}
        }
        return parseDate(s);
    }
}

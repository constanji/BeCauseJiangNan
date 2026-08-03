package ai.dat.adapter.mysql;

import org.apache.calcite.avatica.util.TimeUnitRange;
import org.apache.calcite.sql.SqlCall;
import org.apache.calcite.sql.SqlDialect;
import org.apache.calcite.sql.SqlIntervalQualifier;
import org.apache.calcite.sql.SqlNode;
import org.apache.calcite.sql.SqlWriter;
import org.apache.calcite.sql.dialect.MysqlSqlDialect;
import org.apache.calcite.sql.fun.SqlStdOperatorTable;

/**
 * @Author JunjieM
 * @Date 2025/9/11
 */
public class DatMysqlSqlDialect extends MysqlSqlDialect {

    public static final SqlDialect DEFAULT = new DatMysqlSqlDialect(DEFAULT_CONTEXT);

    public DatMysqlSqlDialect(Context context) {
        super(context);
    }

    @Override
    public void unparseCall(SqlWriter writer, SqlCall call, int leftPrec, int rightPrec) {
        switch (call.getKind()) {
            case BETWEEN:
                // Use standard BETWEEN handling
                super.unparseCall(writer, call, leftPrec, rightPrec);
                break;
            case EXTRACT:
                // 处理EXTRACT函数-转换为MySQL本地函数
                // EXTRACT（MONTH从日期）->MONTH（日期）
                unparseExtract(writer, call);
                break;
            default:
                super.unparseCall(writer, call, leftPrec, rightPrec);
        }
    }

    /**
     * 将ANSI EXTRACT函数转换为MySQL本地日期函数。
     * EXTRACT(YEAR FROM date) -> YEAR（date）
     * EXTRACT（MONTH从日期）->MONTH（日期）
     * EXTRACT(DAY FROM date) -> DAY（日期）
     */
    private void unparseExtract(SqlWriter writer, SqlCall call) {
        SqlNode intervalQualifier = call.operand(0);
        SqlNode dateExpr = call.operand(1);

        if (intervalQualifier instanceof SqlIntervalQualifier) {
            TimeUnitRange timeUnit = ((SqlIntervalQualifier) intervalQualifier).timeUnitRange;
            String mysqlFunc = getMysqlDateFunction(timeUnit);

            if (mysqlFunc != null) {
                writer.print(mysqlFunc);
                writer.print("(");
                dateExpr.unparse(writer, 0, 0);
                writer.print(")");
                return;
            }
        }

        // 如果没有找到映射，则退回到标准提取
        SqlStdOperatorTable.EXTRACT.unparse(writer, call, 0, 0);
    }

    /**
     * 将TimeUnitRange映射为MySQL原生日期函数名。
     */
    private String getMysqlDateFunction(TimeUnitRange timeUnit) {
        return switch (timeUnit) {
            case YEAR -> "YEAR";
            case MONTH -> "MONTH";
            case DAY -> "DAY";
            case HOUR -> "HOUR";
            case MINUTE -> "MINUTE";
            case SECOND -> "SECOND";
            case WEEK -> "WEEK";
            case QUARTER -> "QUARTER";
            case DOW -> "DAYOFWEEK";
            case DOY -> "DAYOFYEAR";
            default -> null;
        };
    }
}

package ai.dat.project.datastore.event;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * 项目配置变更事件
 * 当项目被创建、更新或删除时发布此事件
 *
 * @Author DAT Team
 * @Date 2026/07/16
 */
@Getter
public class ProjectChangedEvent extends ApplicationEvent {

    /**
     * 变更类型
     */
    public enum ChangeType {
        CREATED,
        UPDATED,
        DELETED
    }

    private final String projectId;
    private final ChangeType changeType;

    public ProjectChangedEvent(Object source, String projectId, ChangeType changeType) {
        super(source);
        this.projectId = projectId;
        this.changeType = changeType;
    }

    @Override
    public String toString() {
        return "ProjectChangedEvent{" +
                "projectId='" + projectId + '\'' +
                ", changeType=" + changeType +
                '}';
    }
}

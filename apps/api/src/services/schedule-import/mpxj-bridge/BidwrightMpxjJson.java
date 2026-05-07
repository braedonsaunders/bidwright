import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.mpxj.Duration;
import org.mpxj.ProjectCalendar;
import org.mpxj.ProjectFile;
import org.mpxj.Relation;
import org.mpxj.Resource;
import org.mpxj.ResourceAssignment;
import org.mpxj.Task;
import org.mpxj.reader.UniversalProjectReader;

public class BidwrightMpxjJson {
  private static final ObjectMapper JSON = new ObjectMapper().disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);

  public static void main(String[] args) throws Exception {
    if (args.length != 1) {
      System.err.println("Usage: BidwrightMpxjJson <schedule-file>");
      System.exit(2);
    }

    ProjectFile project = new UniversalProjectReader().read(args[0]);
    Map<String, Object> output = new LinkedHashMap<>();
    output.put("source", "mpxj");
    output.put("tasks", tasks(project));
    output.put("dependencies", dependencies(project));
    output.put("resources", resources(project));
    output.put("assignments", assignments(project));
    output.put("calendars", calendars(project));
    JSON.writeValue(System.out, output);
  }

  private static Object value(Object value) {
    return value == null ? null : value.toString();
  }

  private static Map<String, Object> duration(Duration duration) {
    if (duration == null) {
      return null;
    }
    Map<String, Object> output = new LinkedHashMap<>();
    output.put("value", duration.getDuration());
    output.put("units", value(duration.getUnits()));
    return output;
  }

  private static List<Map<String, Object>> tasks(ProjectFile project) {
    List<Map<String, Object>> output = new ArrayList<>();
    for (Task task : project.getTasks()) {
      if (task == null || task.getUniqueID() == null) {
        continue;
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("uniqueId", task.getUniqueID());
      item.put("id", task.getID());
      item.put("name", task.getName());
      item.put("wbs", task.getWBS());
      item.put("outlineNumber", task.getOutlineNumber());
      item.put("outlineLevel", task.getOutlineLevel());
      item.put("parentUniqueId", task.getParentTask() == null ? null : task.getParentTask().getUniqueID());
      item.put("start", value(task.getStart()));
      item.put("finish", value(task.getFinish()));
      item.put("duration", duration(task.getDuration()));
      item.put("percentComplete", task.getPercentageComplete());
      item.put("milestone", task.getMilestone());
      item.put("summary", task.getSummary());
      item.put("critical", task.getCritical());
      item.put("notes", task.getNotes());
      item.put("constraintType", value(task.getConstraintType()));
      item.put("constraintDate", value(task.getConstraintDate()));
      item.put("deadline", value(task.getDeadline()));
      output.add(item);
    }
    return output;
  }

  private static List<Map<String, Object>> dependencies(ProjectFile project) {
    List<Map<String, Object>> output = new ArrayList<>();
    for (Relation relation : project.getRelations()) {
      if (relation == null || relation.getPredecessorTask() == null || relation.getSuccessorTask() == null) {
        continue;
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("uniqueId", relation.getUniqueID());
      item.put("predecessorUniqueId", relation.getPredecessorTask().getUniqueID());
      item.put("successorUniqueId", relation.getSuccessorTask().getUniqueID());
      item.put("type", value(relation.getType()));
      item.put("lag", duration(relation.getLag()));
      output.add(item);
    }
    return output;
  }

  private static List<Map<String, Object>> resources(ProjectFile project) {
    List<Map<String, Object>> output = new ArrayList<>();
    for (Resource resource : project.getResources()) {
      if (resource == null || resource.getUniqueID() == null) {
        continue;
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("uniqueId", resource.getUniqueID());
      item.put("id", resource.getID());
      item.put("name", resource.getName());
      item.put("type", value(resource.getType()));
      item.put("group", resource.getGroup());
      item.put("email", resource.getEmailAddress());
      output.add(item);
    }
    return output;
  }

  private static List<Map<String, Object>> assignments(ProjectFile project) {
    List<Map<String, Object>> output = new ArrayList<>();
    for (ResourceAssignment assignment : project.getResourceAssignments()) {
      if (assignment == null || assignment.getTaskUniqueID() == null || assignment.getResourceUniqueID() == null) {
        continue;
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("uniqueId", assignment.getUniqueID());
      item.put("taskUniqueId", assignment.getTaskUniqueID());
      item.put("resourceUniqueId", assignment.getResourceUniqueID());
      item.put("units", assignment.getUnits());
      item.put("role", assignment.getRole());
      output.add(item);
    }
    return output;
  }

  private static List<Map<String, Object>> calendars(ProjectFile project) {
    List<Map<String, Object>> output = new ArrayList<>();
    for (ProjectCalendar calendar : project.getCalendars()) {
      if (calendar == null || calendar.getUniqueID() == null) {
        continue;
      }
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("uniqueId", calendar.getUniqueID());
      item.put("name", calendar.getName());
      output.add(item);
    }
    return output;
  }
}

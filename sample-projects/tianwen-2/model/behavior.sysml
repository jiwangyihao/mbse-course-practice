package Tianwen2ConfirmedModel {

  @ElementInfo {
    stableId = "activity-sample-return";
    label = "近地小行星取样返回";
    text = "接近目标小行星，执行近距离探测、采样封装与返回准备。";
    category = "activity";
  }
  @RelatedElement {
    elementId = "sampling-return";
  }
  @RelatedElement {
    elementId = "gnc";
  }
  action def activity_sample_return;

  @ElementInfo {
    stableId = "activity-cruise-safety";
    label = "深空巡航安全维持";
    text = "在深空巡航阶段维持姿态、能源和热控安全边界。";
    category = "activity";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  @RelatedElement {
    elementId = "power-thermal";
  }
  @RelatedElement {
    elementId = "gnc";
  }
  action def activity_cruise_safety;

  @ElementInfo {
    stableId = "activity-telemetry-downlink";
    label = "遥测与科学数据下传";
    text = "通过测控通信链路完成深空测控、数据下传和遥测接收。";
    category = "activity";
  }
  @RelatedElement {
    elementId = "ttc-communication";
  }
  action def activity_telemetry_downlink;

  @ElementInfo {
    stableId = "activity-trace-coverage-check";
    label = "模型工件追溯覆盖校验";
    text = "检查需求到结构和行为视图的覆盖关系，并把缺口暴露为可操作校验结果。";
    category = "activity";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  @RelatedElement {
    elementId = "ttc-communication";
  }
  action def activity_trace_coverage_check;

  action def mission_sequence {
    action activity_sample_return_step : activity_sample_return;
    action activity_cruise_safety_step : activity_cruise_safety;
    action activity_telemetry_downlink_step : activity_telemetry_downlink;
    action activity_trace_coverage_check_step : activity_trace_coverage_check;

    flow activity_sample_return_step to activity_cruise_safety_step;
    flow activity_cruise_safety_step to activity_telemetry_downlink_step;
    flow activity_telemetry_downlink_step to activity_trace_coverage_check_step;
  }

  satisfy REQ_TW2_001 by activity_sample_return;
  satisfy REQ_TW2_002 by activity_cruise_safety;
  satisfy REQ_TW2_003 by activity_telemetry_downlink;
  satisfy REQ_TW2_004 by activity_trace_coverage_check;
}

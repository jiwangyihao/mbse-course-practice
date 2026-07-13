package Tianwen2ConfirmedModel {

  @ElementInfo {
    stableId = "REQ-TW2-001";
    label = "小行星采样返回任务";
    text = "探测器应支持近地小行星采样返回任务。";
    category = "requirement";
  }
  requirement def REQ_TW2_001 {
    requirement REQ_TW2_002_child : REQ_TW2_002;
    requirement REQ_TW2_003_child : REQ_TW2_003;
    requirement REQ_TW2_004_child : REQ_TW2_004;
  }

  @ElementInfo {
    stableId = "REQ-TW2-002";
    label = "深空巡航安全边界";
    text = "探测器应在深空巡航阶段维持姿态、能源和热控安全边界。";
    category = "requirement";
  }
  requirement def REQ_TW2_002 {
  }

  @ElementInfo {
    stableId = "REQ-TW2-003";
    label = "测控通信与数据下传";
    text = "探测器应通过测控通信链路下传工程遥测与科学数据。";
    category = "requirement";
  }
  requirement def REQ_TW2_003 {
  }

  @ElementInfo {
    stableId = "REQ-TW2-004";
    label = "模型工件追溯关系";
    text = "探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。";
    category = "requirement";
  }
  requirement def REQ_TW2_004 {
  }

}

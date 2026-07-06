package Tianwen2MinimalModel {
  doc /*
   * 最小 SysML v2 占位模型，用于 issue #2 工作台骨架契约。
   * 后续切片会由建模 Agent 基于确认数据扩展需求、BDD、活动、IBD 和参数视图。
   */

  requirement def SamplingReturnMission {
    doc /* 探测器应支持近地小行星采样返回任务。 */
  }

  part def Tianwen2Probe {
    doc /* 天问二号探测器顶层系统。 */
  }

  part def TTandCSubsystem {
    doc /* 测控通信分系统，用于工程遥测与科学数据下传。 */
  }

  satisfy Tianwen2ProbeSatisfiesSamplingReturnMission {
    subject Tianwen2Probe;
    requirement SamplingReturnMission;
  }
}

package Tianwen2ConfirmedModel {
  doc /*
   * 天问二号任务面向小行星取样返回和主带彗星扩展探测。
   * 由材料导入与确认向导生成，用于后续图形视图渲染。
   */

  requirement def REQ_TW2_001 {
    doc /* REQ-TW2-001：小行星采样返回任务。探测器应支持近地小行星采样返回任务。 */
  }

  requirement def REQ_TW2_002 {
    doc /* REQ-TW2-002：深空巡航安全边界。探测器应在深空巡航阶段维持姿态、能源和热控安全边界。 */
    doc /* derive REQ-TW2-001，形成需求层级。 */
  }

  requirement def REQ_TW2_003 {
    doc /* REQ-TW2-003：测控通信与数据下传。探测器应通过测控通信链路下传工程遥测与科学数据。 */
    doc /* derive REQ-TW2-001，形成需求层级。 */
  }

  requirement def REQ_TW2_004 {
    doc /* REQ-TW2-004：模型工件追溯关系。探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。 */
    doc /* derive REQ-TW2-001，形成需求层级。 */
  }

  part def spacecraft_platform {
    doc /* 航天器平台。 */
  }

  part def sampling_return {
    doc /* 采样返回分系统。 */
    doc /* composition parent spacecraft-platform。 */
  }

  part def ttc_communication {
    doc /* 测控通信分系统。 */
    doc /* composition parent spacecraft-platform。 */
  }

  part def power_thermal {
    doc /* 电源与热控分系统。 */
    doc /* composition parent spacecraft-platform。 */
  }

  part def gnc {
    doc /* 制导导航与控制分系统。 */
    doc /* composition parent spacecraft-platform。 */
  }

  satisfy REQ_TW2_001_spacecraft_platform {
    subject spacecraft_platform;
    requirement REQ_TW2_001;
    doc /* REQ-TW2-001 追溯到 航天器平台，形成满足关系。 */
  }

  satisfy REQ_TW2_001_sampling_return {
    subject sampling_return;
    requirement REQ_TW2_001;
    doc /* REQ-TW2-001 追溯到 采样返回分系统，形成满足关系。 */
  }

  satisfy REQ_TW2_002_spacecraft_platform {
    subject spacecraft_platform;
    requirement REQ_TW2_002;
    doc /* REQ-TW2-002 追溯到 航天器平台，形成满足关系。 */
  }

  satisfy REQ_TW2_002_power_thermal {
    subject power_thermal;
    requirement REQ_TW2_002;
    doc /* REQ-TW2-002 追溯到 电源与热控分系统，形成满足关系。 */
  }

  satisfy REQ_TW2_002_gnc {
    subject gnc;
    requirement REQ_TW2_002;
    doc /* REQ-TW2-002 追溯到 制导导航与控制分系统，形成满足关系。 */
  }

  satisfy REQ_TW2_003_ttc_communication {
    subject ttc_communication;
    requirement REQ_TW2_003;
    doc /* REQ-TW2-003 追溯到 测控通信分系统，形成满足关系。 */
  }

  satisfy REQ_TW2_004_spacecraft_platform {
    subject spacecraft_platform;
    requirement REQ_TW2_004;
    doc /* REQ-TW2-004 追溯到 航天器平台，形成满足关系。 */
  }

  satisfy REQ_TW2_004_ttc_communication {
    subject ttc_communication;
    requirement REQ_TW2_004;
    doc /* REQ-TW2-004 追溯到 测控通信分系统，形成满足关系。 */
  }
}

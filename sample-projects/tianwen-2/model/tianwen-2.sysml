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

  interface def sample_transfer {
    doc /* IBD 端口接口 sample-transfer，用于端口连接静态校验。 */
  }

  interface def power_thermal_interface {
    doc /* IBD 端口接口 power-thermal，用于端口连接静态校验。 */
  }

  interface def telemetry_data {
    doc /* IBD 端口接口 telemetry-data，用于端口连接静态校验。 */
  }

  part def spacecraft_platform {
    doc /* 航天器平台。 */
    port sample_return_mechanical_interface : sample_transfer;
    port platform_power_thermal_bus : power_thermal_interface;
  }

  connection def connection_sample_transfer_to_platform {
    end source : sampling_return::sample_transfer_out;
    end target : spacecraft_platform::sample_return_mechanical_interface;
    doc /* IBD 内部块连接：样品转移连接，sampling-return.sample-transfer-out -> spacecraft-platform.sample-return-mechanical-interface。 */
  }

  connection def connection_sample_telemetry_to_ttc {
    end source : sampling_return::sample_telemetry_out;
    end target : ttc_communication::data_bus_in;
    doc /* IBD 内部块连接：采样遥测数据连接，sampling-return.sample-telemetry-out -> ttc-communication.data-bus-in。 */
  }

  connection def connection_power_thermal_to_sampling {
    end source : power_thermal::power_thermal_service;
    end target : sampling_return::sample_power_thermal_in;
    doc /* IBD 内部块连接：供电与热控连接，power-thermal.power-thermal-service -> sampling-return.sample-power-thermal-in。 */
  }

  connection def connection_gnc_data_to_ttc {
    end source : gnc::attitude_control_data;
    end target : ttc_communication::telemetry_downlink;
    doc /* IBD 内部块连接：姿态遥测数据连接，gnc.attitude-control-data -> ttc-communication.telemetry-downlink。 */
  }

  part def sampling_return {
    doc /* 采样返回分系统。 */
    doc /* composition parent spacecraft-platform。 */
    port sample_transfer_out : sample_transfer;
    port sample_telemetry_out : telemetry_data;
    port sample_power_thermal_in : power_thermal_interface;
  }

  part def ttc_communication {
    doc /* 测控通信分系统。 */
    doc /* composition parent spacecraft-platform。 */
    port data_bus_in : telemetry_data;
    port telemetry_downlink : telemetry_data;
  }

  part def power_thermal {
    doc /* 电源与热控分系统。 */
    doc /* composition parent spacecraft-platform。 */
    port power_thermal_service : power_thermal_interface;
    port thermal_control : power_thermal_interface;
  }

  part def gnc {
    doc /* 制导导航与控制分系统。 */
    doc /* composition parent spacecraft-platform。 */
    port attitude_control_data : telemetry_data;
  }

  action def activity_sample_return {
    doc /* 近地小行星取样返回。接近目标小行星，执行近距离探测、采样封装与返回准备。 */
    doc /* cover REQ-TW2-001。 */
    doc /* performed by 采样返回分系统、制导导航与控制分系统。 */
  }

  action def activity_cruise_safety {
    doc /* 深空巡航安全维持。在深空巡航阶段维持姿态、能源和热控安全边界。 */
    doc /* cover REQ-TW2-002。 */
    doc /* performed by 航天器平台、电源与热控分系统、制导导航与控制分系统。 */
  }

  action def activity_telemetry_downlink {
    doc /* 遥测与科学数据下传。通过测控通信链路完成深空测控、数据下传和遥测接收。 */
    doc /* cover REQ-TW2-003。 */
    doc /* performed by 测控通信分系统。 */
  }

  action def activity_trace_coverage_check {
    doc /* 模型工件追溯覆盖校验。检查需求到结构和行为视图的覆盖关系，并把缺口暴露为可操作校验结果。 */
    doc /* cover REQ-TW2-004。 */
    doc /* performed by 航天器平台、测控通信分系统。 */
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
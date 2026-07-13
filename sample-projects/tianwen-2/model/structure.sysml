package Tianwen2ConfirmedModel {

  port def sample_transfer;
  port def telemetry_data;
  port def power_thermal_port;

  @ElementInfo {
    stableId = "spacecraft-platform";
    label = "航天器平台";
    category = "system";
  }
  part def spacecraft_platform {
    part sampling_return_member : sampling_return;
    part ttc_communication_member : ttc_communication;
    part power_thermal_member : power_thermal;
    part gnc_member : gnc;

    @ElementInfo {
      stableId = "sample-return-mechanical-interface";
      label = "样品转移接口";
      category = "port";
      kind = "sample";
      interfaceId = "sample-transfer";
    }
    port sample_return_mechanical_interface : ~sample_transfer;
  }

  @ElementInfo {
    stableId = "sampling-return";
    label = "采样返回分系统";
    category = "subsystem";
  }
  part def sampling_return {
    @ElementInfo {
      stableId = "sample-transfer-out";
      label = "样品转移与封装接口";
      category = "port";
      kind = "sample";
      interfaceId = "sample-transfer";
    }
    port sample_transfer_out : sample_transfer;
    @ElementInfo {
      stableId = "sample-telemetry-out";
      label = "采样遥测数据接口";
      category = "port";
      kind = "data";
      interfaceId = "telemetry-data";
    }
    port sample_telemetry_out : telemetry_data;
    @ElementInfo {
      stableId = "sample-power-thermal-in";
      label = "采样供电与热控接口";
      category = "port";
      kind = "power";
      interfaceId = "power-thermal";
    }
    port sample_power_thermal_in : ~power_thermal_port;
  }

  @ElementInfo {
    stableId = "ttc-communication";
    label = "测控通信分系统";
    category = "subsystem";
  }
  part def ttc_communication {
    @ElementInfo {
      stableId = "data-bus-in";
      label = "遥测数据接收接口";
      category = "port";
      kind = "data";
      interfaceId = "telemetry-data";
    }
    port data_bus_in : ~telemetry_data;
    @ElementInfo {
      stableId = "telemetry-downlink";
      label = "测控通信下传接口";
      category = "port";
      kind = "control";
      interfaceId = "telemetry-data";
    }
    port telemetry_downlink : ~telemetry_data;
  }

  @ElementInfo {
    stableId = "power-thermal";
    label = "电源与热控分系统";
    category = "subsystem";
  }
  part def power_thermal {
    @ElementInfo {
      stableId = "power-thermal-service";
      label = "供电与热控服务接口";
      category = "port";
      kind = "power";
      interfaceId = "power-thermal";
    }
    port power_thermal_service : power_thermal_port;
  }

  @ElementInfo {
    stableId = "gnc";
    label = "制导导航与控制分系统";
    category = "subsystem";
  }
  part def gnc {
    @ElementInfo {
      stableId = "attitude-control-data";
      label = "姿态控制数据接口";
      category = "port";
      kind = "control";
      interfaceId = "telemetry-data";
    }
    port attitude_control_data : telemetry_data;
  }

  part system_context {
    part spacecraft_platform_instance : spacecraft_platform;
    part sampling_return_instance : sampling_return;
    part ttc_communication_instance : ttc_communication;
    part power_thermal_instance : power_thermal;
    part gnc_instance : gnc;

    @ElementInfo {
      stableId = "connection-sample-transfer-to-platform";
      label = "样品转移接口";
      category = "connection";
      kind = "sample";
      interfaceId = "sample-transfer";
    }
    connection connection_sample_transfer_to_platform connect sampling_return_instance.sample_transfer_out to spacecraft_platform_instance.sample_return_mechanical_interface;
    @ElementInfo {
      stableId = "connection-sample-telemetry-to-ttc";
      label = "采样遥测数据接口";
      category = "connection";
      kind = "data";
      interfaceId = "telemetry-data";
    }
    connection connection_sample_telemetry_to_ttc connect sampling_return_instance.sample_telemetry_out to ttc_communication_instance.data_bus_in;
    @ElementInfo {
      stableId = "connection-power-thermal-to-sampling";
      label = "供电与热控接口";
      category = "connection";
      kind = "power";
      interfaceId = "power-thermal";
    }
    connection connection_power_thermal_to_sampling connect power_thermal_instance.power_thermal_service to sampling_return_instance.sample_power_thermal_in;
    @ElementInfo {
      stableId = "connection-gnc-data-to-ttc";
      label = "姿态遥测数据接口";
      category = "connection";
      kind = "control";
      interfaceId = "telemetry-data";
    }
    connection connection_gnc_data_to_ttc connect gnc_instance.attitude_control_data to ttc_communication_instance.telemetry_downlink;
  }

  satisfy REQ_TW2_001 by spacecraft_platform;
  satisfy REQ_TW2_001 by sampling_return;
  satisfy REQ_TW2_002 by spacecraft_platform;
  satisfy REQ_TW2_002 by power_thermal;
  satisfy REQ_TW2_002 by gnc;
  satisfy REQ_TW2_003 by ttc_communication;
  satisfy REQ_TW2_004 by spacecraft_platform;
  satisfy REQ_TW2_004 by ttc_communication;

  satisfy REQ_TW2_001 by connection_sample_transfer_to_platform;
  satisfy REQ_TW2_003 by connection_sample_telemetry_to_ttc;
  satisfy REQ_TW2_002 by connection_power_thermal_to_sampling;
  satisfy REQ_TW2_002 by connection_gnc_data_to_ttc;
  satisfy REQ_TW2_003 by connection_gnc_data_to_ttc;
}

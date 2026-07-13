package Tianwen2ConfirmedModel {

  @ElementInfo {
    stableId = "constraint-mass-budget";
    label = "质量预算约束";
    text = "spacecraft-dry-mass <= 1000 kg";
    category = "constraint";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  @RelatedElement {
    elementId = "sampling-return";
  }
  constraint def constraint_mass_budget {
    in mass;
    mass <= 1000
  }

  @ElementInfo {
    stableId = "constraint-power-budget";
    label = "电源输出约束";
    text = "solar-array-output >= 2000 W";
    category = "constraint";
  }
  @RelatedElement {
    elementId = "power-thermal";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  constraint def constraint_power_budget {
    in power;
    power >= 2000
  }

  @ElementInfo {
    stableId = "spacecraft-dry-mass";
    label = "探测器干质量";
    category = "parameter";
    unit = "kg";
    unitSymbol = "kg";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  @RelatedElement {
    elementId = "sampling-return";
  }
  attribute def spacecraft_dry_mass;

  @ElementInfo {
    stableId = "solar-array-output";
    label = "太阳翼输出功率";
    category = "parameter";
    unit = "W";
    unitSymbol = "W";
  }
  @RelatedElement {
    elementId = "power-thermal";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  attribute def solar_array_output;

  @ElementInfo {
    stableId = "binding-mass-budget-dry-mass";
    label = "质量参数绑定";
    category = "binding";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  @RelatedElement {
    elementId = "sampling-return";
  }
  binding binding_mass_budget_dry_mass of constraint_mass_budget = spacecraft_dry_mass;

  @ElementInfo {
    stableId = "binding-power-budget-solar-array-output";
    label = "功率参数绑定";
    category = "binding";
  }
  @RelatedElement {
    elementId = "power-thermal";
  }
  @RelatedElement {
    elementId = "spacecraft-platform";
  }
  binding binding_power_budget_solar_array_output of constraint_power_budget = solar_array_output;

  satisfy REQ_TW2_001 by constraint_mass_budget;
  satisfy REQ_TW2_002 by constraint_power_budget;
}

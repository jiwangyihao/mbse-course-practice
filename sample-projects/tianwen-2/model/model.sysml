metadata def ProjectInfo {
  attribute projectId;
  attribute packageName;
  attribute source;
}

metadata def ElementInfo {
  attribute stableId;
  attribute label;
  attribute text;
  attribute category;
  attribute kind;
  attribute unit;
  attribute unitSymbol;
  attribute interfaceId;
}

metadata def RelatedElement {
  attribute elementId;
}

@ProjectInfo {
  projectId = "tianwen-2";
  packageName = "Tianwen2ConfirmedModel";
  source = "sysml-source-set-derived";
}
package Tianwen2ConfirmedModel {}

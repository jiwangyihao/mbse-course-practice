package DemoAnalysis {
    private import ISQ::*;
    private import NumericalFunctions::*;

    constraint def MassConstraint {
        in totalMass : MassValue;
        in componentMasses : MassValue[0..*];
        totalMass == sum(componentMasses)
    }
}

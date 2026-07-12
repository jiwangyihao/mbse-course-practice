package DemoStruct {
    private import ISQ::*;
    private import DemoReqs::*;
    private import DemoAnalysis::*;

    part def Component {
        attribute mass : MassValue;
    }

    part def Vehicle {
        part engine : Component;
        part fuelSys : Component;
        attribute mass : MassValue;
    }

    part vehicle : Vehicle {
        assert constraint massConstraint : MassConstraint;
        bind massConstraint.totalMass = mass;
        bind massConstraint.componentMasses = engine.mass;
        bind massConstraint.componentMasses = fuelSys.mass;
        satisfy RootReq by vehicle;
    }
}

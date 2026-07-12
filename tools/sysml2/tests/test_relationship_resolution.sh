#!/bin/bash
# Relationship resolution integration test
#
# Verifies normal validation populates resolvedSource/resolvedTarget for imported
# relationships, while --no-validate leaves them absent.
#
# Usage: test_relationship_resolution.sh <sysml2_path>

set -euo pipefail

SYSML2="$1"

if [ ! -x "$SYSML2" ]; then
    echo "FAIL: sysml2 executable not found: $SYSML2"
    exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/reqs.sysml" <<'EOF'
package DemoReqs {
    requirement def RootReq;
}
EOF

cat > "$TMP_DIR/structure.sysml" <<'EOF'
package DemoStruct {
    private import DemoReqs::*;

    part vehicleParam {
        satisfy RootReq by vehicleParam;
    }
}
EOF

normal_output="$($SYSML2 -f json -I "$TMP_DIR" "$TMP_DIR/structure.sysml" 2>/dev/null)"
if [ $? -ne 0 ]; then
    echo "FAIL: normal validation run failed"
    exit 1
fi

if ! echo "$normal_output" | grep -q '"sourceRaw": "RootReq"'; then
    echo "FAIL: expected lexical sourceRaw in normal JSON output"
    exit 1
fi

if ! echo "$normal_output" | grep -q '"resolvedSource": "DemoReqs::RootReq"'; then
    echo "FAIL: expected resolvedSource in normal JSON output"
    exit 1
fi

if ! echo "$normal_output" | grep -q '"resolvedTarget": "DemoStruct::vehicleParam"'; then
    echo "FAIL: expected resolvedTarget in normal JSON output"
    exit 1
fi

query_output="$($SYSML2 -s 'DemoReqs::RootReq' -s 'DemoStruct::vehicleParam' -f json -I "$TMP_DIR" "$TMP_DIR/structure.sysml" 2>/dev/null)"
if [ $? -ne 0 ]; then
    echo "FAIL: query selection run failed"
    exit 1
fi

if ! echo "$query_output" | grep -q '"id": "DemoReqs::RootReq"'; then
    echo "FAIL: expected imported requirement in query JSON output"
    exit 1
fi

if ! echo "$query_output" | grep -q '"id": "DemoStruct::vehicleParam"'; then
    echo "FAIL: expected selected part in query JSON output"
    exit 1
fi

if ! echo "$query_output" | grep -q '"sourceRaw": "RootReq"'; then
    echo "FAIL: expected lexical sourceRaw in query JSON output"
    exit 1
fi

if ! echo "$query_output" | grep -q '"resolvedSource": "DemoReqs::RootReq"'; then
    echo "FAIL: expected resolvedSource in query JSON output"
    exit 1
fi

if ! echo "$query_output" | grep -q '"resolvedTarget": "DemoStruct::vehicleParam"'; then
    echo "FAIL: expected resolvedTarget in query JSON output"
    exit 1
fi

no_validate_output="$($SYSML2 --no-validate -f json -I "$TMP_DIR" "$TMP_DIR/structure.sysml" 2>/dev/null)"
if [ $? -ne 0 ]; then
    echo "FAIL: --no-validate run failed"
    exit 1
fi

if echo "$no_validate_output" | grep -q '"resolvedSource"'; then
    echo "FAIL: --no-validate must not emit resolvedSource"
    exit 1
fi

if echo "$no_validate_output" | grep -q '"resolvedTarget"'; then
    echo "FAIL: --no-validate must not emit resolvedTarget"
    exit 1
fi

AMBIG_DIR="$TMP_DIR/ambiguous-case"
mkdir -p "$AMBIG_DIR"

cat > "$AMBIG_DIR/pkg_a.sysml" <<'EOF'
package PkgA {
    requirement def RootReq;
}
EOF

cat > "$AMBIG_DIR/pkg_b.sysml" <<'EOF'
package PkgB {
    requirement def RootReq;
}
EOF

cat > "$AMBIG_DIR/ambiguous.sysml" <<'EOF'
package DemoStruct {
    private import PkgA::*;
    private import PkgB::*;

    part vehicleParam {
        satisfy RootReq by vehicleParam;
    }
}
EOF

ambiguous_output="$($SYSML2 -f json -I "$AMBIG_DIR" "$AMBIG_DIR/ambiguous.sysml" 2>/dev/null)"
if [ $? -ne 0 ]; then
    echo "FAIL: ambiguous validation run failed"
    exit 1
fi

if ! echo "$ambiguous_output" | grep -q '"sourceRaw": "RootReq"'; then
    echo "FAIL: expected lexical sourceRaw in ambiguous JSON output"
    exit 1
fi

if echo "$ambiguous_output" | grep -q '"resolvedSource"'; then
    echo "FAIL: ambiguous import must not emit resolvedSource"
    exit 1
fi

if ! echo "$ambiguous_output" | grep -q '"resolvedTarget": "DemoStruct::vehicleParam"'; then
    echo "FAIL: ambiguous import should still resolve target"
    exit 1
fi
echo "PASS: relationship resolution integration"
exit 0

# 🔧 SysML v2 CLI

The Swiss Army knife for SysML v2 — parse, validate, query, and modify models from the command line. Written in C with Clang-style diagnostics.

## ✨ Features

- 🚀 **PackCC PEG parser** - Generated from `grammar/sysml.peg`, fast and maintainable
- 🧠 **Arena memory allocation** - Fast allocation/deallocation, cache-friendly
- 🎯 **Clang-style diagnostics** - Clear error messages with source context and suggestions
- 📦 **KerML and SysML v2 support** - Parses both language layers
- 📤 **JSON/SysML output** - Semantic graph output for visualization and round-trip processing
- 🔍 **Semantic analysis** - Detects undefined references, duplicates, type errors
- 🔎 **Query API** - `--select` for pattern-based element selection
- ✏️ **Modification API** - `--delete` and `--set --at` for CRUD operations
- 👀 **Dry-run mode** - `--dry-run` for safe previewing of modifications

## 🏗️ Building

Requirements:
- CMake 3.16+
- C11 compiler (validated in this repo with GCC/Clang; MSVC is currently not a supported, verified toolchain here)
```bash
mkdir build && cd build
cmake ..
make
```

For debug builds:
```bash
cmake -DCMAKE_BUILD_TYPE=Debug ..
```

## 💻 Usage

```
sysml2 - SysML v2 CLI

Usage: sysml2 [options] <file>...

Options:
  -o, --output <file>    Write output to file
  -f, --format <fmt>     Output format: json, xml, sysml (default: none)
  -I <path>              Add library search path for imports
      --fix              Format and rewrite files in place
  -P, --parse-only       Parse only, skip semantic validation
      --no-validate      Same as --parse-only
      --no-resolve       Disable automatic import resolution
  -s, --select <pattern> Filter output to matching elements (repeatable)
  --set <file> --at <scope>  Insert elements from file into scope
  --delete <pattern>     Delete elements matching pattern (repeatable)
  --dry-run              Preview modifications without writing
  --create-scope         Auto-create target scope if missing
  --replace-scope        Clear target scope before inserting (preserves fragment order)
  --color[=when]         Colorize output (auto, always, never)
  --max-errors <n>       Stop after n errors (default: 20)
  -W<warning>            Enable warning (e.g., -Werror)
  --dump-tokens          Dump lexer tokens
  --dump-ast             Dump parsed AST
  -v, --verbose          Verbose output
  -h, --help             Show help
  --version              Show version

Environment:
  SYSML2_LIBRARY_PATH    Colon-separated list of library search paths
```

### 📋 Examples

Validate a KerML file:
```bash
./sysml2 model.kerml
```

Parse and output JSON semantic graph:
```bash
./sysml2 -f json model.sysml > model.json
```

The JSON output includes elements (packages, definitions, usages) and relationships:
```json
{
  "meta": { "version": "1.0", "source": "model.sysml" },
  "elements": [
    { "id": "Pkg::Part", "name": "Part", "type": "PartDef", "parent": "Pkg" }
  ],
  "relationships": []
}
```

Show lexer tokens (for debugging):
```bash
./sysml2 --dump-tokens file.kerml
```

### 🔎 Query Examples

Select specific element:
```bash
./sysml2 --select 'Package::Element' -f json model.sysml
```

Select all direct children:
```bash
./sysml2 --select 'Package::*' -f json model.sysml
```

Select all descendants recursively:
```bash
./sysml2 --select 'Package::**' -f json model.sysml
```

### ✏️ Modification Examples

Delete an element (with `--fix` to write back):
```bash
./sysml2 --delete 'Pkg::OldElement' model.sysml --fix
```

Insert elements from a fragment file:
```bash
./sysml2 --set fragment.sysml --at 'Pkg' model.sysml --fix
```

Insert from stdin:
```bash
echo 'part def Car;' | sysml2 --set - --at 'Vehicles' model.sysml --fix
```

Preview changes without writing:
```bash
./sysml2 --delete 'Legacy::**' --dry-run model.sysml
```

Replace scope contents (preserves fragment element order):
```bash
# Useful for fixing E3002 ordering errors - declarations must come before redefinitions
./sysml2 --set reordered.sysml --at 'Package' --replace-scope model.sysml --fix
```

Create scope if missing and replace its contents:
```bash
./sysml2 --set data.sysml --at 'Root::NewScope' --create-scope --replace-scope model.sysml --fix
```

## 🚨 Error Messages

The parser provides Clang-style error messages with source context:

```
model.kerml:15:23: error[E2001]: expected ';' after feature declaration
   |
15 |     feature engine : Engine
   |                           ^ expected ';'
   |
   = help: add ';' to complete the declaration

model.kerml:20:17: error[E3001]: undefined type 'Engin'
   |
20 |     feature x : Engin;
   |                 ^^^^^ not found
   |
   = help: did you mean 'Engine'?
```

## 🔍 Semantic Validation

The parser performs semantic validation to catch errors beyond syntax:

### Error Types

| Code | Description |
|------|-------------|
| E3001 | Undefined type reference |
| E3002 | Undefined feature in redefines |
| E3003 | Undefined namespace in imports |
| E3004 | Duplicate definition in same scope |
| E3005 | Circular specialization chain |
| E3006 | Type compatibility mismatch |
| E3007 | Invalid multiplicity bounds |
| E3008 | Redefinition compatibility error |

### 📦 Cross-File Import Resolution

The parser supports two modes of cross-file import resolution:

#### Automatic Import Resolution (Recommended)

Use the `-I` flag to specify library search paths. The parser will automatically find and parse imported files:

```bash
# Specify library paths with -I
./sysml2 -I /path/to/library model.sysml

# Multiple library paths
./sysml2 -I /path/to/kernel -I /path/to/domain model.sysml

# Using environment variable
export SYSML2_LIBRARY_PATH="/path/to/kernel:/path/to/domain"
./sysml2 model.sysml
```

Example with verbose output:
```bash
$ ./sysml2 -v -I ./my-library test.sysml
note: added library path: /home/user/my-library
Processing: test.sysml
note: resolving import 'MyTypes' -> /home/user/my-library/MyTypes.sysml
```

The resolver searches library paths for files matching the package name:
- For `import Foo::*;`, searches for `Foo.sysml` or `Foo.kerml`
- Searches recursively in subdirectories (up to 5 levels deep)
- Caches parsed files to avoid re-parsing
- Automatically adds directories of input files to search paths (for cross-file imports within a project)
- Detects and handles circular imports

Use `--no-resolve` to disable automatic resolution:
```bash
./sysml2 --no-resolve model.sysml  # Like the old behavior
```

#### Manual Multi-File Mode

Alternatively, provide all files explicitly on the command line:

```bash
# File A defines types, File B imports them
./sysml2 package_a.sysml package_b.sysml
```

```sysml
// package_a.sysml
package A {
    part def Engine;
    datatype Real;
}

// package_b.sysml
package B {
    import A::*;
    part car : Engine;      // Resolves via import
    attribute weight : Real; // Resolves via import
}
```

Supported import patterns:
- `import A::Engine;` - Direct element import
- `import A::*;` - Namespace import (all direct members)
- `import A::**;` - Recursive import (all nested members)

### Validation Options

```bash
./sysml2 model.sysml                  # Full validation (default)
./sysml2 --parse-only model.sysml     # Syntax check only, skip validation
./sysml2 --no-validate model.sysml    # Same as --parse-only
```

## 📝 Supported Language Features

### KerML
- Namespaces and packages
- Types, classifiers, classes, datatypes, structs
- Features with direction (in/out/inout)
- Specialization (`:>`), subsetting (`::>`), redefinition (`:>>`)
- Multiplicity (`[0..1]`, `[*]`)
- Associations, behaviors, functions, predicates
- Comments and documentation

### SysML v2
- Part definitions and usages
- Action definitions and usages
- State definitions and usages
- Requirement and constraint definitions
- Port definitions
- Interface definitions
- Item definitions
- Attribute definitions
- Enumeration definitions
- Datatype definitions (KerML primitive types)

## 🧪 Testing

Run the test suite:
```bash
cd build
ctest --output-on-failure
```

Or use the check target:
```bash
ninja check   # or: make check
```

Run individual test groups:
```bash
./test_lexer            # Lexer unit tests
./test_ast              # AST/builder/JSON unit tests
./test_validator        # Validator unit tests
./test_query            # Query unit tests
./test_modify           # Modification unit tests
./test_memory           # Memory tests
ctest -R json_output    # JSON fixture tests
ctest -R validation     # Validation fixture tests
ctest -R crud           # CRUD integration tests
```

## 📁 Project Structure

```
sysml2/
├── include/sysml2/     # Header files
│   ├── common.h        # Common types and macros
│   ├── arena.h         # Arena allocator
│   ├── intern.h        # String interning
│   ├── token.h         # Token definitions
│   ├── lexer.h         # Lexer interface
│   ├── diagnostic.h    # Error reporting
│   ├── cli.h           # CLI options
│   ├── ast.h           # AST node types
│   ├── ast_builder.h   # AST builder context
│   ├── json_writer.h       # JSON serialization
│   ├── sysml_writer.h      # SysML/KerML output
│   ├── import_resolver.h   # Automatic import resolution
│   ├── validator.h         # Semantic validator
│   ├── symtab.h            # Symbol table
│   ├── query.h             # Query API
│   ├── modify.h            # Modification API
│   ├── pipeline.h          # Processing pipeline
│   ├── sysml_parser.h      # Parser interface
│   └── utils.h             # Utility functions
├── src/
│   ├── arena.c             # Arena allocator implementation
│   ├── intern.c            # String interning implementation
│   ├── keywords.c          # Keyword recognition
│   ├── lexer.c             # Lexer implementation
│   ├── diagnostic.c        # Diagnostic reporting
│   ├── ast.c               # AST utilities
│   ├── ast_builder.c       # AST builder implementation
│   ├── json_writer.c       # JSON writer implementation
│   ├── sysml_writer.c      # SysML writer implementation
│   ├── import_resolver.c   # Import resolution implementation
│   ├── validator.c         # Semantic validation
│   ├── query.c             # Query implementation
│   ├── modify.c            # Modification implementation
│   ├── pipeline.c          # Pipeline implementation
│   ├── main.c              # CLI entry point
│   └── sysml_parser.c      # PackCC-generated parser
├── grammar/
│   └── sysml.peg       # PEG grammar (source of truth)
├── tests/
│   ├── test_lexer.c           # Lexer unit tests
│   ├── test_ast.c             # AST/builder/JSON unit tests
│   ├── test_validator.c       # Validator unit tests
│   ├── test_packcc_parser.c   # Parser integration tests
│   ├── test_query.c           # Query unit tests
│   ├── test_modify.c          # Modification unit tests
│   ├── test_memory.c          # Memory/arena tests
│   ├── test_diagnostic.c      # Diagnostic tests
│   ├── test_import_resolver.c # Import resolver tests
│   ├── test_json_writer.c     # JSON writer tests
│   ├── test_sysml_writer.c    # SysML writer tests
│   ├── test_json_output.sh    # JSON output fixture tests
│   ├── test_validation.sh     # Validation fixture tests
│   ├── test_crud.sh           # CLI CRUD integration tests
│   └── fixtures/              # Test fixtures
│       ├── json/              # JSON output test pairs
│       ├── validation/        # Validation test cases
│       ├── official/          # Official SysML v2 examples
│       └── errors/            # Error case tests
└── CMakeLists.txt
```

## 📄 License

MIT License

## 📚 References

- [SysML v2 Release Repository](https://github.com/Systems-Modeling/SysML-v2-Release)
- [OMG SysML v2 Specification](https://www.omg.org/sysml/sysmlv2/)

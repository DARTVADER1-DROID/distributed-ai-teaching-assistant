# RAG Server

Cross-platform C++ RAG processing components. The current pipeline contains:

1. PDF validation
2. PDF text extraction
3. Text chunking

Embedding and vector storage are intentionally not part of the current build.

## Official toolchain

The repository uses one build system and one dependency manager across platforms:

- C++17 (kept at the existing project language level)
- CMake 3.25 or newer
- Ninja
- Clang/LLVM 18 on Windows and Linux; Apple Clang on macOS
- vcpkg manifest mode for third-party dependencies

Windows uses `clang-cl` with the Visual Studio C++ Build Tools, linker, and Windows SDK. This preserves compatibility with the Windows C/C++ runtime while using Clang as the compiler. Linux uses upstream Clang. macOS uses Apple Clang.

The vcpkg baseline is pinned in `vcpkg.json`. Do not install Poppler manually or mix package-manager copies of the same dependency with vcpkg.

## Prerequisites

| Platform | Required tools |
|---|---|
| Windows 10/11 x64 | Git, CMake 3.25+, Ninja, LLVM/Clang 18, Visual Studio C++ Build Tools and Windows SDK |
| Linux x64 | Git, CMake 3.25+, Ninja, Clang 18, pkg-config, autoconf, autoconf-archive, automake and libtool |
| macOS x64 or ARM64 | Xcode Command Line Tools, Git, CMake 3.25+, Ninja, pkg-config, autoconf, autoconf-archive, automake and libtool |

vcpkg is bootstrapped locally; the repository pins the exact vcpkg revision through its manifest baseline.

## One-time dependency-manager setup

Run the dependency-manager setup from the repository root. After bootstrapping vcpkg, change into `rag-server` before configuring and building.

### Windows PowerShell

```powershell
$env:VCPKG_ROOT = "$PWD\.vcpkg"
git clone https://github.com/microsoft/vcpkg.git $env:VCPKG_ROOT
git -C $env:VCPKG_ROOT checkout e6d62cc9ce8f8d9687df14521118f2ec3c10ee6a
& "$env:VCPKG_ROOT\bootstrap-vcpkg.bat" -disableMetrics
```

### Linux

```bash
export VCPKG_ROOT="$PWD/.vcpkg"
git clone https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT"
git -C "$VCPKG_ROOT" checkout e6d62cc9ce8f8d9687df14521118f2ec3c10ee6a
"$VCPKG_ROOT/bootstrap-vcpkg.sh" -disableMetrics
```

### macOS

Install the Xcode Command Line Tools first, then install the vcpkg host build tools with `brew install ninja pkg-config autoconf autoconf-archive automake libtool`:

```bash
export VCPKG_ROOT="$PWD/.vcpkg"
git clone https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT"
git -C "$VCPKG_ROOT" checkout e6d62cc9ce8f8d9687df14521118f2ec3c10ee6a
"$VCPKG_ROOT/bootstrap-vcpkg.sh" -disableMetrics
```

Keep `VCPKG_ROOT` set in each terminal session used to configure the project.

## Configure and build

Run the following commands from the `rag-server` directory:

### Windows (Clang-CL + Ninja)

Open a Visual Studio Developer PowerShell or otherwise initialise the Visual Studio C++ environment, then:

```powershell
cmake --preset windows-clang
cmake --build --preset windows-clang --parallel 2
```

### Linux (Clang + Ninja)

```bash
cmake --preset linux-clang
cmake --build --preset linux-clang --parallel 2
```

### macOS x64 (Apple Clang + Ninja)

```bash
cmake --preset macos-clang
cmake --build --preset macos-clang --parallel 2
```

### macOS Apple Silicon (Apple Clang + Ninja)

```bash
cmake --preset macos-arm64-clang
cmake --build --preset macos-arm64-clang --parallel 2
```

The presets select the compiler, Ninja generator, vcpkg toolchain, target triplet and isolated build directory. Do not reuse a build directory after changing compiler, architecture, generator or triplet; remove that preset's build directory and configure again.

## Build outputs

The main executable is `rag_pipeline_test`. Its output is under the selected preset's build tree, in the `pipeline-test` subdirectory. The validator, extractor and chunker are built as libraries and linked into that executable.

The current CI verifies configuration and compilation on Windows, Linux and macOS. It does not yet claim runtime PDF parity across platforms; representative PDF fixtures and automated behavioral tests should be added before making that claim.

## Dependency policy

- Add third-party libraries to `vcpkg.json`, not through ad-hoc system installations.
- Keep the vcpkg baseline pinned.
- Prefer portable C++ and standard-library facilities.
- Isolate unavoidable platform-specific code behind small interfaces.
- Never mix MinGW-built libraries with MSVC-ABI libraries.
- Do not add ONNX Runtime or embedding dependencies until the embedding service is reintroduced as a separately validated component.

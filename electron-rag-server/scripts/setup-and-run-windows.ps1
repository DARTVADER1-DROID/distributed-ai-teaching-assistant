$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackageRoot = Split-Path -Parent $PSScriptRoot
Set-Location $PackageRoot

$RequiredModelFiles = @(
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "onnx/model.onnx",
    "onnx/model.onnx_data"
)

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-ConfigString([string]$PropertyName) {
    $configFile = Join-Path $PackageRoot "config/config.ts"
    $configText = Get-Content -LiteralPath $configFile -Raw
    $pattern = 'public\s+' + [regex]::Escape($PropertyName) + '\s*=\s*"([^"]+)"'
    $match = [regex]::Match($configText, $pattern)
    if (-not $match.Success) {
        throw "Could not read '$PropertyName' from config/config.ts."
    }
    return $match.Groups[1].Value
}

$TokenizerModelId = Get-ConfigString "tokenizer_model_id"
$TokenizerModelRevision = Get-ConfigString "tokenizer_model_revision"
$EmbeddingModelId = Get-ConfigString "embedding_model_id"
$EmbeddingModelRevision = Get-ConfigString "embedding_model_revision"

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$FailureMessage) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

function Test-SupportedNode([string]$VersionText) {
    if ($VersionText -notmatch '^v?(\d+)\.(\d+)\.(\d+)') { return $false }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    return (($major -eq 22 -and $minor -ge 13) -or $major -ge 24)
}

function Ensure-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Windows Package Manager (winget) is unavailable. Install/update 'App Installer' from Microsoft Store, then run this launcher again."
    }
}

function Ensure-Node {
    Write-Step "Checking Node.js and npm"
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Ensure-Winget
        Write-Host "Node.js is missing. Installing the current Node.js LTS release..."
        Invoke-Checked "winget" @(
            "install", "--id", "OpenJS.NodeJS.LTS", "--exact",
            "--silent", "--accept-package-agreements", "--accept-source-agreements"
        ) "Node.js installation failed."
        Refresh-Path
    }

    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw "Node.js was installed but is not visible in this PowerShell session. Close this window and double-click START-WINDOWS.bat again."
    }

    $nodeVersion = (& node --version).Trim()
    if (-not (Test-SupportedNode $nodeVersion)) {
        Ensure-Winget
        Write-Host "Node.js $nodeVersion is outside the supported range. Installing/upgrading Node.js LTS..."
        & winget upgrade --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Invoke-Checked "winget" @(
                "install", "--id", "OpenJS.NodeJS.LTS", "--exact",
                "--silent", "--accept-package-agreements", "--accept-source-agreements"
            ) "Node.js LTS installation/upgrade failed."
        }
        Refresh-Path
        $nodeVersion = (& node --version).Trim()
        if (-not (Test-SupportedNode $nodeVersion)) {
            throw "Node.js $nodeVersion is still unsupported. Install Node.js 22.13+ or 24+ and rerun."
        }
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm was not found alongside Node.js. Repair the Node.js installation and rerun."
    }

    Write-Host "Node.js: $nodeVersion"
    Write-Host "npm: $(& npm --version)"
}

function Get-PythonLauncher {
    if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    return $null
}

function Ensure-HuggingFaceCli {
    Write-Step "Checking Hugging Face download tooling"

    if (Get-Command hf -ErrorAction SilentlyContinue) {
        Write-Host "Hugging Face CLI: already available"
        return
    }

    $pythonLauncher = Get-PythonLauncher
    if (-not $pythonLauncher) {
        Ensure-Winget
        Write-Host "Python is needed only to install the Hugging Face download CLI. Installing Python 3.12..."
        Invoke-Checked "winget" @(
            "install", "--id", "Python.Python.3.12", "--exact",
            "--scope", "user", "--silent",
            "--accept-package-agreements", "--accept-source-agreements"
        ) "Python installation failed."
        Refresh-Path
        $pythonLauncher = Get-PythonLauncher
    }

    if (-not $pythonLauncher) {
        throw "Python installation completed but its launcher is unavailable. Restart Windows or add Python to PATH, then rerun."
    }

    if ($pythonLauncher -eq "py") {
        $scriptsDirectory = (& py -3 -c "import sysconfig; print(sysconfig.get_path('scripts', scheme='nt_user'))").Trim()
    } else {
        $scriptsDirectory = (& python -c "import sysconfig; print(sysconfig.get_path('scripts', scheme='nt_user'))").Trim()
    }
    if ($scriptsDirectory -and (Test-Path $scriptsDirectory)) {
        $env:Path = "$scriptsDirectory;$env:Path"
    }

    if (-not (Get-Command hf -ErrorAction SilentlyContinue)) {
        Write-Host "Installing the Hugging Face CLI..."
        if ($pythonLauncher -eq "py") {
            Invoke-Checked "py" @("-3", "-m", "pip", "install", "--user", "huggingface_hub") "Could not install huggingface_hub."
        } else {
            Invoke-Checked "python" @("-m", "pip", "install", "--user", "huggingface_hub") "Could not install huggingface_hub."
        }
        if ($scriptsDirectory -and (Test-Path $scriptsDirectory)) {
            $env:Path = "$scriptsDirectory;$env:Path"
        }
    }

    if (-not (Get-Command hf -ErrorAction SilentlyContinue)) {
        throw "The Hugging Face CLI was installed but 'hf' is not available on PATH. Add the Python user Scripts directory to PATH and rerun."
    }
    Write-Host "Hugging Face CLI: available"
}

function Resolve-ConfiguredPath([string]$Root, [string]$Child) {
    if ([IO.Path]::IsPathRooted($Child)) {
        return [IO.Path]::GetFullPath($Child)
    }
    if ([IO.Path]::IsPathRooted($Root)) {
        return [IO.Path]::GetFullPath((Join-Path $Root $Child))
    }
    return [IO.Path]::GetFullPath((Join-Path $PackageRoot (Join-Path $Root $Child)))
}

function Test-ModelFiles([string]$Directory) {
    foreach ($relativeFile in $RequiredModelFiles) {
        $filePath = Join-Path $Directory ($relativeFile -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { return $false }
        if ((Get-Item -LiteralPath $filePath).Length -le 0) { return $false }
    }
    return $true
}

function Ensure-ModelDirectory([string]$Directory, [string]$RepositoryId, [string]$Revision) {
    if (Test-ModelFiles $Directory) {
        Write-Host "Model files already present: $Directory"
        return
    }

    Write-Host "Model files are missing or incomplete. Downloading the pinned BGE-M3 snapshot..."
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $downloadArguments = @(
        "download", $RepositoryId
    ) + $RequiredModelFiles + @(
        "--revision", $Revision,
        "--local-dir", $Directory
    )
    Invoke-Checked "hf" $downloadArguments "BGE-M3 model download failed. Check your internet connection and available disk space."

    if (-not (Test-ModelFiles $Directory)) {
        throw "The model download command completed, but one or more required files are still missing or empty in $Directory."
    }
    Write-Host "Model files verified: $Directory"
}

function Ensure-Models {
    Write-Step "Checking local BGE-M3 model files"
    $modelRoot = if ($env:MODEL_DIRECTORY) { $env:MODEL_DIRECTORY } else { Get-ConfigString "model_directory" }
    $tokenizerDirectory = if ($env:TOKENIZER_MODEL_DIRECTORY) { $env:TOKENIZER_MODEL_DIRECTORY } else { Get-ConfigString "tokenizer_model_directory" }
    $embeddingDirectory = if ($env:EMBEDDING_MODEL_DIRECTORY) { $env:EMBEDDING_MODEL_DIRECTORY } else { Get-ConfigString "embedding_model_directory" }

    $tokenizerPath = Resolve-ConfiguredPath $modelRoot $tokenizerDirectory
    $embeddingPath = Resolve-ConfiguredPath $modelRoot $embeddingDirectory

    Ensure-ModelDirectory $tokenizerPath $TokenizerModelId $TokenizerModelRevision
    if ($embeddingPath -ne $tokenizerPath) {
        Ensure-ModelDirectory $embeddingPath $EmbeddingModelId $EmbeddingModelRevision
    } elseif ($TokenizerModelId -ne $EmbeddingModelId -or $TokenizerModelRevision -ne $EmbeddingModelRevision) {
        throw "Tokenizer and embedding model paths are identical, but config/config.ts specifies different model snapshots. Give them separate directories."
    }
}

function Ensure-NpmDependencies {
    Write-Step "Checking npm dependencies"
    if (-not (Test-Path "package-lock.json")) {
        Write-Host "No package-lock.json exists yet. Generating it from package.json..."
        Invoke-Checked "npm" @("install", "--package-lock-only") "Could not generate package-lock.json."
        Write-Warning "A package-lock.json was generated locally. Commit it to Git so future installations are reproducible."
    }

    $dependenciesHealthy = $false
    if (Test-Path "node_modules") {
        & npm ls --depth=0 *> $null
        $dependenciesHealthy = ($LASTEXITCODE -eq 0)
    }

    if ($dependenciesHealthy) {
        Write-Host "Installed npm dependencies are present and satisfy package.json."
    } else {
        Write-Host "npm dependencies are missing or inconsistent. Installing from package-lock.json..."
        Invoke-Checked "npm" @("ci") "npm ci failed. Check the error above."
    }
}

function Start-Server {
    Write-Step "Building and testing the software"
    Invoke-Checked "npm" @("run", "build") "Build or test suite failed. The server will not be started."

    $port = if ($env:PORT) { $env:PORT } else { "3000" }
    $healthUrl = "http://localhost:$port/health"
    $docsUrl = "http://localhost:$port/docs"

    try {
        $healthResponse = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ($healthResponse.StatusCode -ge 200 -and $healthResponse.StatusCode -lt 300) {
            Write-Host "A healthy server is already running at $healthUrl"
            Start-Process $docsUrl
            return
        }
    } catch {
        # No healthy instance responded; check whether another process owns the port.
    }

    $portNumber = 0
    if ([int]::TryParse($port, [ref]$portNumber)) {
        $portInUse = (Test-NetConnection -ComputerName "localhost" -Port $portNumber -WarningAction SilentlyContinue).TcpTestSucceeded
        if ($portInUse) {
            throw "Port $portNumber is already in use, but the RAG health endpoint did not respond. Stop the other process or change PORT, then rerun."
        }
    }

    Write-Step "Starting Electron RAG server"
    Write-Host "Swagger UI: $docsUrl"
    Write-Host "Health:     $healthUrl"
    Write-Host "Press Ctrl+C in this window to stop the server."
    & npm start
    if ($LASTEXITCODE -ne 0) {
        throw "The server exited with code $LASTEXITCODE."
    }
}

try {
    Write-Host "Electron RAG Server - Windows setup and launch" -ForegroundColor Green
    Write-Host "Package directory: $PackageRoot"
    Ensure-Node
    Ensure-HuggingFaceCli
    Ensure-NpmDependencies
    Ensure-Models
    Start-Server
}
catch {
    Write-Host ""
    Write-Host "SETUP / LAUNCH FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Fix the reported issue and double-click START-WINDOWS.bat again."
    exit 1
}

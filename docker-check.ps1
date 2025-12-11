# Docker 构建和启动检查脚本 (PowerShell)
# 用途：检查 Docker 配置、构建镜像、启动服务并验证

$ErrorActionPreference = "Stop"

# 颜色函数
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# 检查 Docker 是否安装
function Test-Docker {
    Write-Info "检查 Docker 环境..."
    
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker 未安装，请先安装 Docker"
        exit 1
    }
    
    if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue) -and 
        -not (docker compose version 2>$null)) {
        Write-Error "Docker Compose 未安装，请先安装 Docker Compose"
        exit 1
    }
    
    Write-Info "Docker 环境检查通过"
}

# 检查必要的文件
function Test-Files {
    Write-Info "检查必要的文件..."
    
    $missingFiles = @()
    
    # 检查 Dockerfile
    if (-not (Test-Path "api/Dockerfile")) { $missingFiles += "api/Dockerfile" }
    if (-not (Test-Path "frontend/Dockerfile")) { $missingFiles += "frontend/Dockerfile" }
    
    # 检查 docker-compose 文件
    if (-not (Test-Path "docker-compose.yml")) { $missingFiles += "docker-compose.yml" }
    
    # 检查初始化脚本
    if (-not (Test-Path "api/migrations/000_init_schema.sql")) { 
        $missingFiles += "api/migrations/000_init_schema.sql" 
    }
    
    if ($missingFiles.Count -gt 0) {
        Write-Error "缺少以下文件："
        $missingFiles | ForEach-Object { Write-Host "  - $_" }
        exit 1
    }
    
    Write-Info "文件检查通过"
}

# 检查端口占用
function Test-Ports {
    Write-Info "检查端口占用..."
    
    $ports = @(3000, 3001, 5432)
    $occupiedPorts = @()
    
    foreach ($port in $ports) {
        $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connection) {
            $occupiedPorts += $port
        }
    }
    
    if ($occupiedPorts.Count -gt 0) {
        Write-Warn "以下端口已被占用："
        $occupiedPorts | ForEach-Object { Write-Host "  - $_" }
        Write-Warn "请确保这些端口未被其他服务使用，或修改 docker-compose.yml 中的端口映射"
    } else {
        Write-Info "端口检查通过"
    }
}

# 检查 .env 文件
function Test-Env {
    Write-Info "检查环境变量文件..."
    
    if (-not (Test-Path "api/.env")) {
        Write-Warn "api/.env 文件不存在"
        if (Test-Path "api/env.example") {
            Write-Info "可以复制 api/env.example 创建 api/.env"
        }
    } else {
        Write-Info "api/.env 文件存在"
    }
}

# 构建镜像
function Build-Images {
    param([string]$ComposeFile)
    
    Write-Info "构建 Docker 镜像..."
    
    if ($ComposeFile -eq "docker-compose.dev.yml") {
        docker-compose -f $ComposeFile build
    } else {
        docker-compose build
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "镜像构建成功"
    } else {
        Write-Error "镜像构建失败"
        exit 1
    }
}

# 启动服务
function Start-Services {
    param([string]$ComposeFile)
    
    Write-Info "启动 Docker 服务..."
    
    if ($ComposeFile -eq "docker-compose.dev.yml") {
        docker-compose -f $ComposeFile up -d
    } else {
        docker-compose up -d
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "服务启动成功"
    } else {
        Write-Error "服务启动失败"
        exit 1
    }
}

# 等待服务就绪
function Wait-ForServices {
    Write-Info "等待服务就绪..."
    
    $maxAttempts = 30
    
    # 等待 PostgreSQL
    Write-Info "等待 PostgreSQL 就绪..."
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        $result = docker-compose exec -T postgres pg_isready -U trading_user -d trading_db 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "PostgreSQL 已就绪"
            break
        }
        $attempt++
        Start-Sleep -Seconds 2
    }
    
    if ($attempt -eq $maxAttempts) {
        Write-Error "PostgreSQL 启动超时"
        exit 1
    }
    
    # 等待 API
    Write-Info "等待 API 服务就绪..."
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Info "API 服务已就绪"
                break
            }
        } catch {
            # 继续等待
        }
        $attempt++
        Start-Sleep -Seconds 2
    }
    
    if ($attempt -eq $maxAttempts) {
        Write-Error "API 服务启动超时"
        exit 1
    }
    
    # 等待 Frontend
    Write-Info "等待 Frontend 服务就绪..."
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/" -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Info "Frontend 服务已就绪"
                break
            }
        } catch {
            # 继续等待
        }
        $attempt++
        Start-Sleep -Seconds 2
    }
    
    if ($attempt -eq $maxAttempts) {
        Write-Warn "Frontend 服务启动超时（可能仍在构建中）"
    }
}

# 检查服务健康状态
function Test-Health {
    Write-Info "检查服务健康状态..."
    
    # 检查 API 健康
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -TimeoutSec 5 -ErrorAction Stop
        Write-Info "✓ API 服务健康"
    } catch {
        Write-Error "✗ API 服务不健康"
        return $false
    }
    
    # 检查 Frontend
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/" -TimeoutSec 5 -ErrorAction Stop
        Write-Info "✓ Frontend 服务健康"
    } catch {
        Write-Warn "✗ Frontend 服务可能未就绪"
    }
    
    # 检查容器状态
    Write-Info "容器状态："
    docker-compose ps
    
    return $true
}

# 主函数
function Main {
    param([string]$Mode = "production")
    
    $composeFile = "docker-compose.yml"
    
    if ($Mode -eq "dev") {
        $composeFile = "docker-compose.dev.yml"
        Write-Info "使用开发环境配置"
    } else {
        Write-Info "使用生产环境配置"
    }
    
    Write-Info "开始 Docker 环境检查..."
    Write-Host ""
    
    Test-Docker
    Test-Files
    Test-Ports
    Test-Env
    
    Write-Host ""
    $confirm = Read-Host "是否继续构建和启动服务？(y/n)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Info "已取消"
        exit 0
    }
    
    Write-Host ""
    Build-Images $composeFile
    
    Write-Host ""
    Start-Services $composeFile
    
    Write-Host ""
    Wait-ForServices
    
    Write-Host ""
    Test-Health
    
    Write-Host ""
    Write-Info "Docker 环境检查完成！"
    Write-Info "服务地址："
    Write-Host "  - Frontend: http://localhost:3000"
    Write-Host "  - API: http://localhost:3001"
    Write-Host "  - API Health: http://localhost:3001/api/health"
    Write-Host ""
    Write-Info "查看日志: docker-compose -f $composeFile logs -f"
    Write-Info "停止服务: docker-compose -f $composeFile down"
}

# 运行主函数
$mode = $args[0]
Main -Mode $mode


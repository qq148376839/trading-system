#!/bin/bash

# Docker 构建和启动检查脚本
# 用途：检查 Docker 配置、构建镜像、启动服务并验证

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Docker 是否安装
check_docker() {
    print_info "检查 Docker 环境..."
    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose 未安装，请先安装 Docker Compose"
        exit 1
    fi
    
    print_info "Docker 环境检查通过"
}

# 检查必要的文件
check_files() {
    print_info "检查必要的文件..."
    
    local missing_files=()
    
    # 检查 Dockerfile
    [ ! -f "api/Dockerfile" ] && missing_files+=("api/Dockerfile")
    [ ! -f "frontend/Dockerfile" ] && missing_files+=("frontend/Dockerfile")
    
    # 检查 docker-compose 文件
    [ ! -f "docker-compose.yml" ] && missing_files+=("docker-compose.yml")
    
    # 检查初始化脚本
    [ ! -f "api/migrations/000_init_schema.sql" ] && missing_files+=("api/migrations/000_init_schema.sql")
    
    if [ ${#missing_files[@]} -gt 0 ]; then
        print_error "缺少以下文件："
        for file in "${missing_files[@]}"; do
            echo "  - $file"
        done
        exit 1
    fi
    
    print_info "文件检查通过"
}

# 检查端口占用
check_ports() {
    print_info "检查端口占用..."
    
    local ports=(3000 3001 5432)
    local occupied_ports=()
    
    for port in "${ports[@]}"; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 || netstat -an 2>/dev/null | grep -q ":$port.*LISTEN"; then
            occupied_ports+=($port)
        fi
    done
    
    if [ ${#occupied_ports[@]} -gt 0 ]; then
        print_warn "以下端口已被占用："
        for port in "${occupied_ports[@]}"; do
            echo "  - $port"
        done
        print_warn "请确保这些端口未被其他服务使用，或修改 docker-compose.yml 中的端口映射"
    else
        print_info "端口检查通过"
    fi
}

# 检查 .env 文件
check_env() {
    print_info "检查环境变量文件..."
    
    if [ ! -f "api/.env" ]; then
        print_warn "api/.env 文件不存在"
        if [ -f "api/env.example" ]; then
            print_info "可以复制 api/env.example 创建 api/.env"
        fi
    else
        print_info "api/.env 文件存在"
    fi
}

# 构建镜像
build_images() {
    print_info "构建 Docker 镜像..."
    
    local compose_file=${1:-docker-compose.yml}
    
    if docker-compose -f $compose_file build; then
        print_info "镜像构建成功"
    else
        print_error "镜像构建失败"
        exit 1
    fi
}

# 启动服务
start_services() {
    print_info "启动 Docker 服务..."
    
    local compose_file=${1:-docker-compose.yml}
    
    if docker-compose -f $compose_file up -d; then
        print_info "服务启动成功"
    else
        print_error "服务启动失败"
        exit 1
    fi
}

# 等待服务就绪
wait_for_services() {
    print_info "等待服务就绪..."
    
    local max_attempts=30
    local attempt=0
    
    # 等待 PostgreSQL
    print_info "等待 PostgreSQL 就绪..."
    while [ $attempt -lt $max_attempts ]; do
        if docker-compose exec -T postgres pg_isready -U trading_user -d trading_db >/dev/null 2>&1; then
            print_info "PostgreSQL 已就绪"
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        print_error "PostgreSQL 启动超时"
        exit 1
    fi
    
    # 等待 API
    print_info "等待 API 服务就绪..."
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -f http://localhost:3001/api/health >/dev/null 2>&1; then
            print_info "API 服务已就绪"
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        print_error "API 服务启动超时"
        exit 1
    fi
    
    # 等待 Frontend
    print_info "等待 Frontend 服务就绪..."
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -f http://localhost:3000/ >/dev/null 2>&1; then
            print_info "Frontend 服务已就绪"
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        print_warn "Frontend 服务启动超时（可能仍在构建中）"
    fi
}

# 检查服务健康状态
check_health() {
    print_info "检查服务健康状态..."
    
    # 检查 API 健康
    if curl -f http://localhost:3001/api/health >/dev/null 2>&1; then
        print_info "✓ API 服务健康"
    else
        print_error "✗ API 服务不健康"
        return 1
    fi
    
    # 检查 Frontend
    if curl -f http://localhost:3000/ >/dev/null 2>&1; then
        print_info "✓ Frontend 服务健康"
    else
        print_warn "✗ Frontend 服务可能未就绪"
    fi
    
    # 检查容器状态
    print_info "容器状态："
    docker-compose ps
}

# 显示日志
show_logs() {
    print_info "显示服务日志（最后50行）..."
    docker-compose logs --tail=50
}

# 主函数
main() {
    local mode=${1:-production}
    local compose_file="docker-compose.yml"
    
    if [ "$mode" = "dev" ]; then
        compose_file="docker-compose.dev.yml"
        print_info "使用开发环境配置"
    else
        print_info "使用生产环境配置"
    fi
    
    print_info "开始 Docker 环境检查..."
    echo ""
    
    check_docker
    check_files
    check_ports
    check_env
    
    echo ""
    read -p "是否继续构建和启动服务？(y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "已取消"
        exit 0
    fi
    
    echo ""
    build_images $compose_file
    
    echo ""
    start_services $compose_file
    
    echo ""
    wait_for_services
    
    echo ""
    check_health
    
    echo ""
    print_info "Docker 环境检查完成！"
    print_info "服务地址："
    echo "  - Frontend: http://localhost:3000"
    echo "  - API: http://localhost:3001"
    echo "  - API Health: http://localhost:3001/api/health"
    echo ""
    print_info "查看日志: docker-compose -f $compose_file logs -f"
    print_info "停止服务: docker-compose -f $compose_file down"
}

# 运行主函数
main "$@"


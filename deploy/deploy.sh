#!/bin/bash
# =============================================================================
# Workflow Manager - Deployment Script
# =============================================================================
# Builds and deploys server and webui containers
#
# Usage:
#   ./deploy.sh              # Build and deploy all
#   ./deploy.sh --build      # Force rebuild all images
#   ./deploy.sh --server     # Deploy server only
#   ./deploy.sh --webui      # Deploy webui only
#   ./deploy.sh --restart    # Restart without rebuild
#   ./deploy.sh --down       # Stop all containers
#   ./deploy.sh --logs       # Show logs
#   ./deploy.sh --status     # Show container status
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for .env file
check_env() {
    if [ ! -f ".env" ]; then
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and configure it:"
        log_info "  cp .env.example .env"
        exit 1
    fi
    
    # Check required variables
    source .env
    if [ -z "$JWT_SECRET_KEY" ] || [ "$JWT_SECRET_KEY" = "your-secret-key-change-in-production" ]; then
        log_error "JWT_SECRET_KEY is not set or using default value!"
        log_info "Generate a secure key with: openssl rand -hex 32"
        exit 1
    fi
}

# Build images
build_all() {
    log_info "Building all images..."
    docker-compose build
    log_success "Build complete"
}

build_server() {
    log_info "Building server image..."
    docker-compose build server
    log_success "Server build complete"
}

build_webui() {
    log_info "Building webui image..."
    docker-compose build webui
    log_success "WebUI build complete"
}

build_worker() {
    log_info "Building worker image..."
    docker-compose build worker
    log_success "Worker build complete"
}

# Deploy services
deploy_all() {
    log_info "Deploying all services..."
    docker-compose up -d
    log_success "Deployment complete"
    show_status
}

deploy_server() {
    log_info "Deploying server..."
    docker-compose up -d server
    log_success "Server deployed"
}

deploy_webui() {
    log_info "Deploying webui..."
    docker-compose up -d webui
    log_success "WebUI deployed"
}

deploy_worker() {
    log_info "Deploying worker..."
    docker-compose up -d worker
    log_success "Worker deployed"
}

# Restart services
restart_all() {
    log_info "Restarting all services..."
    docker-compose restart
    log_success "Restart complete"
}

# Stop services
stop_all() {
    log_info "Stopping all services..."
    docker-compose down
    log_success "All services stopped"
}

# Show logs
show_logs() {
    docker-compose logs -f
}

# Show status
show_status() {
    echo ""
    log_info "Container Status:"
    echo "----------------------------------------"
    docker-compose ps
    echo ""
    log_info "Service URLs (exposed ports):"
    echo "  MongoDB:  localhost:27017"
    echo "  Server:   localhost:9090"
    echo "  WebUI:    localhost:8080"
    echo "  Worker:   (no port - background service)"
    echo ""
    log_info "Nginx proxy configured to these ports"
}

# Health check
health_check() {
    log_info "Running health checks..."
    
    # Check MongoDB
    if docker-compose exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; then
        log_success "MongoDB: healthy"
    else
        log_error "MongoDB: unhealthy"
    fi
    
    # Check Server
    if curl -sf http://localhost:9090/health &>/dev/null; then
        log_success "Server: healthy"
    else
        log_error "Server: unhealthy"
    fi
    
    # Check WebUI
    if curl -sf http://localhost:8080/health &>/dev/null; then
        log_success "WebUI: healthy"
    else
        log_error "WebUI: unhealthy"
    fi
    
    # Check Worker (check if container is running)
    if docker-compose ps worker 2>/dev/null | grep -q "running"; then
        log_success "Worker: running"
    else
        log_error "Worker: not running"
    fi
}

# Main
main() {
    case "${1:-}" in
        --build)
            check_env
            build_all
            deploy_all
            ;;
        --server)
            check_env
            build_server
            deploy_server
            ;;
        --webui)
            check_env
            build_webui
            deploy_webui
            ;;
        --worker)
            check_env
            build_worker
            deploy_worker
            ;;
        --restart)
            restart_all
            ;;
        --down|--stop)
            stop_all
            ;;
        --logs)
            show_logs
            ;;
        --status)
            show_status
            ;;
        --health)
            health_check
            ;;
        --help|-h)
            echo "Usage: $0 [option]"
            echo ""
            echo "Options:"
            echo "  (none)      Build and deploy all services"
            echo "  --build     Force rebuild all images"
            echo "  --server    Build and deploy server only"
            echo "  --worker    Build and deploy worker only"
            echo "  --webui     Build and deploy webui only"
            echo "  --restart   Restart without rebuild"
            echo "  --down      Stop all containers"
            echo "  --logs      Show container logs"
            echo "  --status    Show container status"
            echo "  --health    Run health checks"
            echo "  --help      Show this help"
            ;;
        *)
            check_env
            build_all
            deploy_all
            ;;
    esac
}

main "$@"

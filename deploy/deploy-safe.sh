#!/bin/bash
# =============================================================================
# Workflow Manager - Safe Deployment Script with Rollback
# =============================================================================
# Builds and deploys containers with confirmation and rollback capability.
#
# Usage:
#   ./deploy-safe.sh                    # Deploy all services with confirmation
#   ./deploy-safe.sh --server           # Deploy server only
#   ./deploy-safe.sh --virtual          # Deploy virtual-server only
#   ./deploy-safe.sh --webui            # Deploy webui only
#   ./deploy-safe.sh --worker           # Deploy worker only
#
# Flow:
#   1. Backup current image tags
#   2. Build new images
#   3. Deploy new containers
#   4. Run health checks
#   5. Wait for user confirmation
#   6. On 'y': Keep new deployment
#   7. On 'n': Rollback to previous images
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# Backup directory for image IDs
BACKUP_DIR="$SCRIPT_DIR/.deploy-backup"
mkdir -p "$BACKUP_DIR"

# Services that can be deployed
ALL_SERVICES="server virtual-server worker webui"

# Check for .env file
check_env() {
    if [ ! -f ".env" ]; then
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and configure it:"
        log_info "  cp .env.example .env"
        exit 1
    fi
    
    source .env
    if [ -z "$JWT_SECRET_KEY" ] || [ "$JWT_SECRET_KEY" = "your-secret-key-change-in-production" ]; then
        log_error "JWT_SECRET_KEY is not set or using default value!"
        log_info "Generate a secure key with: openssl rand -hex 32"
        exit 1
    fi
}

# Get current image ID for a service
get_image_id() {
    local service=$1
    docker-compose images -q "$service" 2>/dev/null || echo ""
}

# Get image name for a service
get_image_name() {
    local service=$1
    docker-compose config | grep -A1 "^  ${service}:" | grep "image:" | awk '{print $2}' 2>/dev/null
    # If no explicit image name, use the built image
    if [ -z "$image_name" ]; then
        echo "deploy-${service}"
    fi
}

# Backup current image IDs
backup_images() {
    local services=$1
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/backup_${timestamp}.txt"
    
    log_step "Backing up current image IDs..."
    
    > "$backup_file"
    for service in $services; do
        local image_id=$(get_image_id "$service")
        if [ -n "$image_id" ]; then
            echo "${service}=${image_id}" >> "$backup_file"
            log_info "  $service: $image_id"
        else
            log_warn "  $service: no existing image"
        fi
    done
    
    # Store latest backup reference
    echo "$backup_file" > "$BACKUP_DIR/latest"
    log_success "Backup saved to $backup_file"
}

# Build images
build_services() {
    local services=$1
    log_step "Building new images..."
    
    for service in $services; do
        log_info "Building $service..."
        docker-compose build "$service"
    done
    
    log_success "Build complete"
}

# Deploy services
deploy_services() {
    local services=$1
    log_step "Deploying services..."
    
    for service in $services; do
        log_info "Deploying $service..."
        docker-compose up -d "$service"
    done
    
    log_success "Deployment complete"
}

# Health check with retries
health_check() {
    local services=$1
    local max_retries=10
    local retry_delay=3
    
    log_step "Running health checks (waiting for services to start)..."
    sleep 5  # Initial wait
    
    local all_healthy=true
    
    for service in $services; do
        local healthy=false
        
        for ((i=1; i<=max_retries; i++)); do
            case $service in
                server)
                    if curl -sf http://localhost:9090/health &>/dev/null; then
                        healthy=true
                        break
                    fi
                    ;;
                virtual-server)
                    if curl -sf http://localhost:9091/health &>/dev/null; then
                        healthy=true
                        break
                    fi
                    ;;
                webui)
                    if curl -sf http://localhost:8080/health &>/dev/null; then
                        healthy=true
                        break
                    fi
                    ;;
                worker)
                    if docker-compose ps "$service" 2>/dev/null | grep -q "running\|Up"; then
                        healthy=true
                        break
                    fi
                    ;;
            esac
            
            log_info "  $service: waiting... (attempt $i/$max_retries)"
            sleep $retry_delay
        done
        
        if [ "$healthy" = true ]; then
            log_success "  $service: healthy"
        else
            log_error "  $service: unhealthy"
            all_healthy=false
        fi
    done
    
    if [ "$all_healthy" = true ]; then
        return 0
    else
        return 1
    fi
}

# Rollback to previous images
rollback() {
    local services=$1
    
    if [ ! -f "$BACKUP_DIR/latest" ]; then
        log_error "No backup found to rollback to!"
        exit 1
    fi
    
    local backup_file=$(cat "$BACKUP_DIR/latest")
    
    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log_step "Rolling back to previous deployment..."
    
    # Stop current containers
    for service in $services; do
        log_info "Stopping $service..."
        docker-compose stop "$service" 2>/dev/null || true
    done
    
    # Restore previous images by retagging
    while IFS='=' read -r service image_id; do
        if [ -n "$image_id" ] && [[ " $services " == *" $service "* ]]; then
            log_info "Restoring $service to image $image_id..."
            
            # Get the image name used by docker-compose
            local image_name=$(docker-compose config | grep -A10 "^  ${service}:" | grep "image:" | head -1 | awk '{print $2}')
            
            if [ -z "$image_name" ]; then
                # Use default naming convention
                image_name="deploy-${service}"
            fi
            
            # Tag the old image back
            docker tag "$image_id" "$image_name" 2>/dev/null || true
        fi
    done < "$backup_file"
    
    # Restart services with old images
    for service in $services; do
        log_info "Starting $service..."
        docker-compose up -d "$service"
    done
    
    log_success "Rollback complete"
}

# Show deployment status
show_status() {
    echo ""
    log_info "Current container status:"
    echo "----------------------------------------"
    docker-compose ps
    echo ""
}

# Interactive confirmation
confirm_deployment() {
    echo ""
    echo "========================================"
    echo -e "${CYAN}DEPLOYMENT VERIFICATION${NC}"
    echo "========================================"
    echo ""
    echo "New deployment is running. Please test the following:"
    echo ""
    echo "  WebUI:          https://arandomsitein.space"
    echo "  Editor:         https://arandomsitein.space/editor/"
    echo "  API:            https://api.arandomsitein.space/health"
    echo "  Virtual API:    https://virtual.api.arandomsitein.space/health"
    echo ""
    echo "Local ports (if testing locally):"
    echo "  WebUI:          http://localhost:8080"
    echo "  API:            http://localhost:9090/health"
    echo "  Virtual API:    http://localhost:9091/health"
    echo ""
    echo "========================================"
    echo ""
    
    while true; do
        echo -e "${YELLOW}Is the deployment working correctly?${NC}"
        echo "  [y] Yes - keep the new deployment"
        echo "  [n] No  - rollback to previous version"
        echo "  [s] Show container status"
        echo "  [l] Show logs"
        echo "  [h] Run health checks"
        echo ""
        read -p "Enter choice [y/n/s/l/h]: " choice
        
        case $choice in
            [Yy]|[Yy][Ee][Ss])
                return 0
                ;;
            [Nn]|[Nn][Oo])
                return 1
                ;;
            [Ss])
                show_status
                ;;
            [Ll])
                echo ""
                log_info "Showing last 50 lines of logs (Ctrl+C to stop)..."
                docker-compose logs --tail=50
                echo ""
                ;;
            [Hh])
                health_check "$DEPLOY_SERVICES"
                ;;
            *)
                log_warn "Invalid choice. Please enter y, n, s, l, or h."
                ;;
        esac
    done
}

# Cleanup old backups (keep last 10)
cleanup_backups() {
    local backup_count=$(ls -1 "$BACKUP_DIR"/backup_*.txt 2>/dev/null | wc -l)
    if [ "$backup_count" -gt 10 ]; then
        log_info "Cleaning up old backups..."
        ls -1t "$BACKUP_DIR"/backup_*.txt | tail -n +11 | xargs rm -f
    fi
}

# Main deployment flow
safe_deploy() {
    local services=$1
    
    echo ""
    echo "========================================"
    echo -e "${CYAN}SAFE DEPLOYMENT WITH ROLLBACK${NC}"
    echo "========================================"
    echo ""
    echo "Services to deploy: $services"
    echo ""
    
    # Store services for use in confirm_deployment
    export DEPLOY_SERVICES="$services"
    
    # Step 1: Backup current images
    backup_images "$services"
    echo ""
    
    # Step 2: Build new images
    build_services "$services"
    echo ""
    
    # Step 3: Deploy new containers
    deploy_services "$services"
    echo ""
    
    # Step 4: Health checks
    if ! health_check "$services"; then
        log_error "Health checks failed!"
        echo ""
        read -p "Rollback now? [Y/n]: " rollback_choice
        if [[ ! "$rollback_choice" =~ ^[Nn] ]]; then
            rollback "$services"
            exit 1
        fi
    fi
    
    # Step 5: Wait for user confirmation
    if confirm_deployment; then
        echo ""
        log_success "Deployment confirmed and complete!"
        cleanup_backups
    else
        echo ""
        log_warn "Rolling back deployment..."
        rollback "$services"
        log_success "Rollback complete. Previous version restored."
    fi
}

# Parse arguments
parse_services() {
    case "${1:-}" in
        --server)
            echo "server"
            ;;
        --virtual|--virtual-server)
            echo "virtual-server"
            ;;
        --webui)
            echo "webui"
            ;;
        --worker)
            echo "worker"
            ;;
        --all|"")
            echo "$ALL_SERVICES"
            ;;
        --help|-h)
            echo "HELP"
            ;;
        *)
            echo "UNKNOWN"
            ;;
    esac
}

# Main
main() {
    local services=$(parse_services "$1")
    
    case "$services" in
        HELP)
            echo "Usage: $0 [option]"
            echo ""
            echo "Safe deployment with rollback capability."
            echo ""
            echo "Options:"
            echo "  (none)      Deploy all services"
            echo "  --all       Deploy all services"
            echo "  --server    Deploy server only"
            echo "  --virtual   Deploy virtual-server only"
            echo "  --worker    Deploy worker only"
            echo "  --webui     Deploy webui only"
            echo "  --help      Show this help"
            echo ""
            echo "Flow:"
            echo "  1. Backup current image IDs"
            echo "  2. Build new images"
            echo "  3. Deploy new containers"
            echo "  4. Run health checks"
            echo "  5. Wait for your confirmation"
            echo "  6. On 'y': Keep new deployment"
            echo "  7. On 'n': Rollback to previous images"
            ;;
        UNKNOWN)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            check_env
            safe_deploy "$services"
            ;;
    esac
}

main "$@"

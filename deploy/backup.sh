#!/bin/bash
# =============================================================================
# MongoDB Backup Script
# =============================================================================
# Creates backups of MongoDB database that can be accessed from network
#
# Usage:
#   ./backup.sh                    # Backup to default location
#   ./backup.sh /path/to/backup    # Backup to specific location
#   ./backup.sh --restore <file>   # Restore from backup
#   ./backup.sh --list             # List available backups
#
# Network Backup:
#   The backup is stored in MONGO_BACKUP_PATH (from .env) which is mounted
#   into the container. Mount this to a network share for remote backups.
#
# Automated Backup (cron):
#   Add to crontab: 0 2 * * * /path/to/deploy/backup.sh >> /var/log/wfm-backup.log 2>&1
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
if [ -f ".env" ]; then
    source .env
fi

# Configuration
CONTAINER_NAME="wfm-mongo"
DB_NAME="${MONGODB_DATABASE:-workflow_db}"
BACKUP_DIR="${MONGO_BACKUP_PATH:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${DB_NAME}_${TIMESTAMP}"
RETENTION_DAYS=7

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if MongoDB container is running
check_container() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        log_error "MongoDB container '${CONTAINER_NAME}' is not running"
        exit 1
    fi
}

# Create backup
do_backup() {
    local backup_path="${1:-$BACKUP_DIR}"
    
    check_container
    
    log_info "Starting backup of database: ${DB_NAME}"
    log_info "Backup location: ${backup_path}"
    
    # Create backup directory if it doesn't exist
    mkdir -p "${backup_path}"
    
    # Run mongodump inside container
    # Output goes to /backups which is mounted to host
    docker exec ${CONTAINER_NAME} mongodump \
        --db="${DB_NAME}" \
        --out="/backups/${BACKUP_NAME}" \
        --quiet
    
    # Compress the backup
    log_info "Compressing backup..."
    tar -czf "${backup_path}/${BACKUP_NAME}.tar.gz" \
        -C "${backup_path}" \
        "${BACKUP_NAME}"
    
    # Remove uncompressed backup
    rm -rf "${backup_path}/${BACKUP_NAME}"
    
    # Get backup size
    local size=$(du -h "${backup_path}/${BACKUP_NAME}.tar.gz" | cut -f1)
    
    log_success "Backup complete: ${BACKUP_NAME}.tar.gz (${size})"
    
    # Cleanup old backups
    cleanup_old_backups "${backup_path}"
}

# Cleanup old backups
cleanup_old_backups() {
    local backup_path="$1"
    
    log_info "Cleaning up backups older than ${RETENTION_DAYS} days..."
    
    local count=$(find "${backup_path}" -name "${DB_NAME}_*.tar.gz" -mtime +${RETENTION_DAYS} | wc -l)
    
    if [ "$count" -gt 0 ]; then
        find "${backup_path}" -name "${DB_NAME}_*.tar.gz" -mtime +${RETENTION_DAYS} -delete
        log_info "Removed ${count} old backup(s)"
    else
        log_info "No old backups to remove"
    fi
}

# List backups
list_backups() {
    local backup_path="${1:-$BACKUP_DIR}"
    
    echo ""
    log_info "Available backups in: ${backup_path}"
    echo "----------------------------------------"
    
    if [ -d "${backup_path}" ]; then
        ls -lh "${backup_path}"/${DB_NAME}_*.tar.gz 2>/dev/null || echo "No backups found"
    else
        echo "Backup directory does not exist"
    fi
    echo ""
}

# Restore from backup
do_restore() {
    local backup_file="$1"
    
    if [ -z "$backup_file" ]; then
        log_error "Please specify a backup file to restore"
        log_info "Usage: $0 --restore <backup_file.tar.gz>"
        list_backups
        exit 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: ${backup_file}"
        exit 1
    fi
    
    check_container
    
    log_warn "This will REPLACE the current database: ${DB_NAME}"
    read -p "Are you sure you want to continue? (yes/no): " confirm
    
    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    log_info "Restoring from: ${backup_file}"
    
    # Extract backup
    local temp_dir=$(mktemp -d)
    tar -xzf "${backup_file}" -C "${temp_dir}"
    
    # Find the extracted directory
    local backup_dir=$(ls -d ${temp_dir}/*/ | head -1)
    local backup_name=$(basename "${backup_dir}")
    
    # Copy to container's backup volume
    cp -r "${backup_dir}" "${BACKUP_DIR}/"
    
    # Drop existing database and restore
    docker exec ${CONTAINER_NAME} mongorestore \
        --db="${DB_NAME}" \
        --drop \
        "/backups/${backup_name}/${DB_NAME}"
    
    # Cleanup
    rm -rf "${temp_dir}"
    rm -rf "${BACKUP_DIR}/${backup_name}"
    
    log_success "Restore complete!"
}

# Remote backup (to network path)
do_remote_backup() {
    local remote_path="$1"
    
    if [ -z "$remote_path" ]; then
        log_error "Please specify a remote path"
        log_info "Usage: $0 --remote /path/to/network/share"
        exit 1
    fi
    
    # First, create local backup
    do_backup "${BACKUP_DIR}"
    
    # Copy to remote
    log_info "Copying to remote: ${remote_path}"
    cp "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" "${remote_path}/"
    
    log_success "Remote backup complete: ${remote_path}/${BACKUP_NAME}.tar.gz"
}

# Main
main() {
    case "${1:-}" in
        --restore)
            do_restore "$2"
            ;;
        --list)
            list_backups "$2"
            ;;
        --remote)
            do_remote_backup "$2"
            ;;
        --help|-h)
            echo "MongoDB Backup Script"
            echo ""
            echo "Usage: $0 [option] [path]"
            echo ""
            echo "Options:"
            echo "  (none)              Create backup to default location"
            echo "  /path/to/backup     Create backup to specific location"
            echo "  --restore <file>    Restore from backup file"
            echo "  --list [path]       List available backups"
            echo "  --remote <path>     Backup to remote/network path"
            echo "  --help              Show this help"
            echo ""
            echo "Environment:"
            echo "  MONGO_BACKUP_PATH   Default backup directory"
            echo "  MONGODB_DATABASE    Database name to backup"
            echo ""
            ;;
        *)
            if [ -n "$1" ] && [ -d "$1" ]; then
                do_backup "$1"
            else
                do_backup
            fi
            ;;
    esac
}

main "$@"

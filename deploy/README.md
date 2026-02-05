# Workflow Manager - Docker Deployment

Production deployment for Workflow Manager using Docker containers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Nginx Proxy                            │
│                                                                 │
│  arandomsitein.space → localhost:8080 (webui)                  │
│  api.arandomsitein.space → localhost:9000 (server)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Containers                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   MongoDB    │  │   Server     │  │   WebUI      │         │
│  │   :27017     │  │   :9000      │  │   :8080      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         │                  │                                    │
│         └──────────────────┘                                    │
│              Internal Network                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
nano .env  # Edit with your values

# 2. Deploy everything
./deploy.sh

# 3. Check status
./deploy.sh --status
```

## Files

| File | Description |
|------|-------------|
| `docker-compose.yml` | Service definitions |
| `Dockerfile.server` | Backend server image |
| `Dockerfile.webui` | Frontend nginx image |
| `nginx.webui.conf` | Nginx config for SPA |
| `.env.example` | Environment template |
| `deploy.sh` | Deployment script |
| `backup.sh` | MongoDB backup script |

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET_KEY` | Secret for JWT tokens (generate with `openssl rand -hex 32`) |
| `CORS_ORIGINS` | Your frontend domain |
| `VITE_API_PROD_URL` | API URL for frontend |

### API Keys

Add your provider API keys in `.env`:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `LEONARDO_API_KEY`
- `MIDAPI_API_KEY`
- `ELEVENLABS_API_KEY`

## Deployment Commands

```bash
# Full deploy (build + start)
./deploy.sh

# Force rebuild
./deploy.sh --build

# Deploy only server
./deploy.sh --server

# Deploy only webui
./deploy.sh --webui

# Restart without rebuild
./deploy.sh --restart

# Stop all
./deploy.sh --down

# View logs
./deploy.sh --logs

# Check health
./deploy.sh --health
```

## Nginx Proxy Configuration

Add these to your existing nginx configuration:

```nginx
# Frontend
server {
    listen 443 ssl http2;
    server_name arandomsitein.space;
    
    # SSL config...
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# API Backend
server {
    listen 443 ssl http2;
    server_name api.arandomsitein.space;
    
    # SSL config...
    
    location / {
        proxy_pass http://localhost:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

## MongoDB Access

MongoDB is exposed on port 27017 for:

### MongoDB Compass
Connect with: `mongodb://localhost:27017`

### User Management Scripts
Run from your local machine:

```bash
# Create user
python scripts/2025_12_30_create_user.py workflow_db \
    --email admin@example.com \
    --password yourpassword \
    --mongo-uri mongodb://localhost:27017

# Update password
python scripts/2025_12_30_update_user_password.py workflow_db \
    --update \
    --email admin@example.com \
    --password newpassword \
    --mongo-uri mongodb://localhost:27017
```

### Network Backup
From another machine on the network:

```bash
mongodump --host=<server-ip> --port=27017 --db=workflow_db --out=/backup/path
```

## Backup

### Manual Backup

```bash
# Create backup
./backup.sh

# Backup to specific location
./backup.sh /path/to/backup

# Backup to network share
./backup.sh --remote /mnt/network/backups

# List backups
./backup.sh --list

# Restore
./backup.sh --restore backups/workflow_db_20260205_120000.tar.gz
```

### Automated Backup (Cron)

```bash
# Add to crontab (daily at 2 AM)
crontab -e

# Add this line:
0 2 * * * /path/to/deploy/backup.sh >> /var/log/wfm-backup.log 2>&1
```

### Network Backup Configuration

1. Mount your network share:
   ```bash
   mount -t nfs backup-server:/backups /mnt/backups
   # or
   mount -t cifs //backup-server/backups /mnt/backups -o user=backup
   ```

2. Set in `.env`:
   ```
   MONGO_BACKUP_PATH=/mnt/backups/workflow-manager
   ```

3. Run backup:
   ```bash
   ./backup.sh
   ```

## Troubleshooting

### Check container logs
```bash
docker-compose logs server
docker-compose logs webui
docker-compose logs mongo
```

### Health check
```bash
./deploy.sh --health
```

### Restart specific service
```bash
docker-compose restart server
```

### Rebuild after code changes
```bash
./deploy.sh --server  # Rebuild and deploy server
./deploy.sh --webui   # Rebuild and deploy webui
```

## Volumes

| Volume | Description |
|--------|-------------|
| `mongo_data` | MongoDB database files |
| `media_data` | Generated media (images, videos, audio) |

### Backup volumes location
```bash
docker volume inspect wfm_mongo_data
```

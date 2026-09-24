#!/usr/bin/env sh
# Builda e publica as imagens do Sistema de OS no Docker Hub.
#
# Uso:
#   docker login
#   ./deploy/build-and-push.sh [namespace] [tag]
#
# Padrão: namespace=onedayinformatica  tag=0.9.0  (também publica :latest)
#
# O frontend é buildado SEM NEXT_PUBLIC_API_URL de propósito: a imagem chama
# /api relativo, servindo qualquer domínio (topologia "mesmo domínio").
# Para domínios separados, builde com:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.exemplo.com.br/api ...
#
# Se o host de deploy for amd64 e você builda noutra arquitetura (ex.: Apple
# Silicon), acrescente --platform linux/amd64 aos dois `docker build`.

set -eu

NS="${1:-onedayinformatica}"
TAG="${2:-0.9.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">> backend: $NS/os-backend:$TAG"
docker build -t "$NS/os-backend:$TAG" -t "$NS/os-backend:latest" "$ROOT/backend"

echo ">> frontend: $NS/os-frontend:$TAG"
docker build -t "$NS/os-frontend:$TAG" -t "$NS/os-frontend:latest" "$ROOT/frontend"

echo ">> push"
docker push "$NS/os-backend:$TAG"
docker push "$NS/os-backend:latest"
docker push "$NS/os-frontend:$TAG"
docker push "$NS/os-frontend:latest"

echo ">> pronto: $NS/os-backend:$TAG e $NS/os-frontend:$TAG publicados."

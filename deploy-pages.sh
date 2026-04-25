#!/usr/bin/env bash
set -euo pipefail

# 一键部署 microbe-colony-atlas 到 GitHub Pages（SSH）
# 默认目标仓库：git@github.com:small-apple-sun/microbe.git
# 默认部署目录：/home/apple/microbe-pages-deploy-sync

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/home/apple/microbe-pages-deploy-sync}"
REMOTE_URL="${REMOTE_URL:-git@github.com:small-apple-sun/microbe.git}"
BRANCH="${BRANCH:-main}"
MSG_PREFIX="${MSG_PREFIX:-Update microbe colony atlas}"
COMMIT_MSG="${1:-${MSG_PREFIX} ($(date '+%Y-%m-%d %H:%M:%S'))}"

echo "[1/5] 准备部署目录: ${DEPLOY_DIR}"
if [[ ! -d "${DEPLOY_DIR}/.git" ]]; then
  rm -rf "${DEPLOY_DIR}"
  git clone "${REMOTE_URL}" "${DEPLOY_DIR}"
fi

echo "[2/5] 同步站点文件"
rsync -a --delete --exclude ".git" "${SRC_DIR}/" "${DEPLOY_DIR}/"

echo "[3/5] 检查并切换分支: ${BRANCH}"
git -C "${DEPLOY_DIR}" fetch origin
if git -C "${DEPLOY_DIR}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git -C "${DEPLOY_DIR}" checkout "${BRANCH}"
else
  git -C "${DEPLOY_DIR}" checkout -b "${BRANCH}"
fi

echo "[4/5] 暂存文件（包含被 ignore 的 webp）"
git -C "${DEPLOY_DIR}" add -A
if compgen -G "${DEPLOY_DIR}/assets/processed/*.webp" > /dev/null; then
  git -C "${DEPLOY_DIR}" add -f assets/processed/*.webp
fi

if git -C "${DEPLOY_DIR}" diff --cached --quiet; then
  echo "[5/5] 没有可提交变更，跳过 push。"
  exit 0
fi

echo "[5/5] 提交并推送到 ${REMOTE_URL} (${BRANCH})"
git -C "${DEPLOY_DIR}" -c alias.commit= commit -m "${COMMIT_MSG}"
git -C "${DEPLOY_DIR}" push origin "${BRANCH}"

echo "部署完成："
echo "  https://small-apple-sun.github.io/microbe/"

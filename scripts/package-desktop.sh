#!/usr/bin/env bash
# 把 TimeTree 封装成桌面应用：
#   1) 生成 .deb 安装包（无需 root，产物在 dist-pkg/）
#   2) 安装到当前用户（~/.local），并在桌面放一个可双击启动的快捷方式
#
# 用法：
#   bash scripts/package-desktop.sh            # 打包 + 安装到用户目录 + 桌面快捷方式
#   bash scripts/package-desktop.sh --no-install  # 只生成 .deb
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$PROJECT_ROOT/src-tauri/target/release/timetree"
VERSION="$(grep -m1 '^version' "$PROJECT_ROOT/src-tauri/Cargo.toml" | sed 's/.*"\(.*\)".*/\1/')"
PKG_ROOT="$PROJECT_ROOT/dist-pkg"
STAGE="$PKG_ROOT/timetree_${VERSION}_amd64"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/桌面}"
[ -d "$DESKTOP_DIR" ] || DESKTOP_DIR="$HOME/Desktop"

INSTALL=1
[ "${1:-}" = "--no-install" ] && INSTALL=0

# 始终做一次「生产构建」：必须带 custom-protocol，
# 否则 Tauri 会以开发模式启动（去连 http://localhost:1420，报 Connection refused）。
# cargo 是增量的，没改动时只需几秒。
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -x "$BIN" ]; then
  echo "==> 跳过构建（SKIP_BUILD=1），使用现有二进制"
else
  echo "==> cargo build --release --features custom-protocol"
  ( cd "$PROJECT_ROOT/src-tauri" && cargo build --release --features custom-protocol ) || {
    echo "✗ 构建失败"; exit 1; }
fi

echo "==> 版本 $VERSION，二进制 $(du -h "$BIN" | cut -f1)"

# ---------------------------------------------------------------------------
# 组装 deb 目录结构
# ---------------------------------------------------------------------------
rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" \
         "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/icons/hicolor/256x256/apps" \
         "$STAGE/usr/share/doc/timetree"

install -m 755 "$BIN" "$STAGE/usr/bin/timetree"
install -m 644 "$PROJECT_ROOT/src-tauri/icons/128x128@2x.png" \
  "$STAGE/usr/share/icons/hicolor/256x256/apps/timetree.png"
install -m 644 "$PROJECT_ROOT/scripts/timetree.desktop" \
  "$STAGE/usr/share/applications/timetree.desktop"
install -m 644 "$PROJECT_ROOT/README.md" "$STAGE/usr/share/doc/timetree/README.md"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: timetree
Version: $VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: TimeTree <timetree@localhost>
Installed-Size: $(du -sk "$STAGE/usr" | cut -f1)
Depends: libc6, libgtk-3-0t64 | libgtk-3-0, libwebkit2gtk-4.1-0, libsoup-3.0-0
Recommends: librsvg2-2
Description: 树状时间笔记 TimeTree
 以「节点全局、日期视图」为核心的本地优先桌面笔记应用。
 同天为图，跨天为树：节点可跨天延续、手动重现、局部编辑，
 多个节点可在某一天共同指向一个独立节点，所有边只属于当天并可一键复制到明天。
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

mkdir -p "$PKG_ROOT"
DEB="$PKG_ROOT/timetree_${VERSION}_amd64.deb"
dpkg-deb --build --root-owner-group "$STAGE" "$DEB" >/dev/null
echo "==> 已生成安装包：$DEB ($(du -h "$DEB" | cut -f1))"

# ---------------------------------------------------------------------------
# 安装到当前用户（不需要 root）
# ---------------------------------------------------------------------------
if [ "$INSTALL" = "1" ]; then
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" \
           "$HOME/.local/share/icons/hicolor/256x256/apps"
  install -m 755 "$BIN" "$HOME/.local/bin/timetree"
  install -m 644 "$PROJECT_ROOT/src-tauri/icons/128x128@2x.png" \
    "$HOME/.local/share/icons/hicolor/256x256/apps/timetree.png"
  # 用户级 desktop 文件用绝对路径，避免 GUI 启动时 PATH 里没有 ~/.local/bin
  sed "s|^Exec=timetree|Exec=$HOME/.local/bin/timetree|" \
    "$PROJECT_ROOT/scripts/timetree.desktop" \
    > "$HOME/.local/share/applications/timetree.desktop"
  chmod 644 "$HOME/.local/share/applications/timetree.desktop"
  command -v update-desktop-database >/dev/null 2>&1 && \
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

  if [ -d "$DESKTOP_DIR" ]; then
    sed "s|^Exec=timetree|Exec=$HOME/.local/bin/timetree|" \
      "$PROJECT_ROOT/scripts/timetree.desktop" > "$DESKTOP_DIR/timetree.desktop"
    chmod 755 "$DESKTOP_DIR/timetree.desktop"
    # GNOME 需要标记为可信才能双击运行
    command -v gio >/dev/null 2>&1 && \
      gio set "$DESKTOP_DIR/timetree.desktop" metadata::trusted true 2>/dev/null || true
    chmod +x "$DESKTOP_DIR/timetree.desktop"
    echo "==> 桌面快捷方式：$DESKTOP_DIR/timetree.desktop"
  fi

  echo "==> 已安装到 ~/.local/bin/timetree（可直接在终端输入 timetree 启动）"
fi

echo "完成 ✅"

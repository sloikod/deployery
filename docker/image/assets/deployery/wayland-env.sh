# /deployery/wayland-env.sh
# Wayland session environment - sourced by ~/.bashrc for interactive terminals.
# Applies to all apps launched from the terminal in the Deployery sandbox.

export LANG=en_US.UTF-8
export XDG_RUNTIME_DIR=/tmp/sway-runtime
export WAYLAND_DISPLAY=wayland-1
export DISPLAY=:0
export XDG_SESSION_TYPE=wayland

# GTK3/4: prefer Wayland backend, fall back through XWayland when needed.
export GDK_BACKEND=wayland,x11
# Qt5/6: use Wayland platform plugin with XWayland/xcb fallback.
export QT_QPA_PLATFORM="wayland;xcb"
# SDL2/3: use Wayland video driver
export SDL_VIDEODRIVER=wayland
# Chrome/Electron: auto-select Wayland when WAYLAND_DISPLAY is set
export ELECTRON_OZONE_PLATFORM_HINT=auto

# Software rendering - force Mesa llvmpipe so OpenGL apps (Chrome, GTK, Qt)
# render via CPU instead of crashing on DRM access.
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe

# PulseAudio socket for apps launched from the terminal
export PULSE_SERVER=unix:/tmp/pulse-runtime/pulse/native

# Cursor theme for toolkit-rendered cursors (GTK/Qt Wayland cursor surfaces).
# Same theme as the Sway compositor seat (set in sway config).
export XCURSOR_THEME=macOS-Monterey
export XCURSOR_SIZE=24

# Cap Node.js heap so user processes GC aggressively instead of ballooning
# into OOM. 4 GB leaves headroom for code-server + system processes.
# Set here (not globally) so it only applies to terminal-launched node,
# not to code-server itself (launched by self-healer before .bashrc runs).
export NODE_OPTIONS="--max-old-space-size=4096"

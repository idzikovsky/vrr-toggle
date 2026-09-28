# VRR Toggle

Gnome Shell extension that adds a global Variable refresh rate switch to the Quick Settings menu.

![Screenshot](screenshot.png)

It is handy to be able to quickly toggle VRR while running some apps and games beacuse of Nvidia 5374195 bug which causes flickering when Low Framerate Compensation kicks in.

## Manual Installation

### 1. Clone the repository to the extension directory
```bash
git clone https://github.com/idzikovsky/vrr-toggle.git ~/.local/share/gnome-shell/extensions/vrr-toggle@idzikovsky.github.io
```

### 2. Compile schemas
```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/vrr-toggle@idzikovsky.github.io/schemas/
```

### 3. Enable the extension
Restart the GNOME Shell session, then run:
```bash
gnome-extensions enable vrr-toggle@idzikovsky.github.io
```

## Usage
There is an option to disable confirmation window that appears when you toggle VRR state.
```bash
gnome-extensions prefs vrr-toggle@idzikovsky.github.io
```

**Note**
Big thanks to https://github.com/Postnozet/vrr-blocker project.

It is a great extension it but does not suite my case, as I run some games using Gamescope which causes those games to run under Gamescope's WM_CLASS.

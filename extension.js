import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';
const IFACE = 'org.gnome.Mutter.DisplayConfig';
const METHOD_PERSISTENT = 2;

// Mode tuple: [id, width, height, refresh, preferredScale, scales, props]
const isVariable = mode => mode[6]['refresh-rate-mode'] === 'variable';

function findCounterpart(modes, current, variable) {
    return modes.find(m =>
        m[1] === current[1] && m[2] === current[2] &&
        Math.abs(m[3] - current[3]) < 0.001 &&
        isVariable(m) === variable);
}

function call(method, params) {
    return Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, IFACE, method, params,
        null, Gio.DBusCallFlags.NONE, -1, null);
}

function subscribeMonitorsChanged(callback) {
    const id = Gio.DBus.session.signal_subscribe(BUS_NAME, IFACE,
        'MonitorsChanged', OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
        () => callback());
    return () => Gio.DBus.session.signal_unsubscribe(id);
}

async function getState() {
    const reply = await call('GetCurrentState', null);
    const [serial, rawMonitors, logicalMonitors, properties] = reply.recursiveUnpack();

    const monitors = new Map();
    for (const [[connector], modes, props] of rawMonitors) {
        const current = modes.find(m => m[6]['is-current']);
        const vrrCapable = !!current &&
            !!findCounterpart(modes, current, !isVariable(current));
        monitors.set(connector, {
            connector,
            name: props['display-name'] ?? connector,
            modes,
            props,
            current,
            vrrCapable,
            vrrEnabled: !!current && isVariable(current),
        });
    }
    return {serial, monitors, logicalMonitors, properties};
}

function monitorProps(p) {
    const out = {};
    if ('color-mode' in p)
        out['color-mode'] = new GLib.Variant('u', p['color-mode']);
    if ('rgb-range' in p)
        out['rgb-range'] = new GLib.Variant('u', p['rgb-range']);
    if ('is-underscanning' in p)
        out['underscanning'] = new GLib.Variant('b', p['is-underscanning']);
    return out;
}

function buildConfig(state, enable) {
    const logical = state.logicalMonitors.map(
        ([x, y, scale, transform, primary, specs]) => [
            x, y, scale, transform, primary,
            specs.map(([connector]) => {
                const mon = state.monitors.get(connector);
                let mode = mon.current;
                if (mon.vrrCapable)
                    mode = findCounterpart(mon.modes, mon.current, enable) ?? mode;
                return [connector, mode[0], monitorProps(mon.props)];
            }),
        ]);

    const props = {};
    if (state.properties['supports-changing-layout-mode'])
        props['layout-mode'] = new GLib.Variant('u', state.properties['layout-mode']);

    return new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
        [state.serial, METHOD_PERSISTENT, logical, props]);
}

async function setVrr(enable) {
    const state = await getState();
    await call('ApplyMonitorsConfig', buildConfig(state, enable));
}

const VrrToggle = GObject.registerClass(
class VrrToggle extends QuickToggle {
    _init(settings) {
        super._init({
            title: 'VRR',
            iconName: 'video-display-symbolic',
            toggleMode: true,
            visible: false,
        });

        this._settings = settings;
        this._syncId = 0;
        this._destroyed = false;
        this._unsubscribe = subscribeMonitorsChanged(() => this._sync());
        this.connect('clicked', () => this._apply(this.checked));
        this._sync();
    }

    async _sync() {
        if (this._destroyed)
            return;
        const id = ++this._syncId;
        try {
            const {monitors} = await getState();
            if (this._destroyed || id !== this._syncId)
                return;
            const capable = [...monitors.values()].filter(m => m.vrrCapable);
            this.visible = capable.length > 0;
            this.checked = capable.some(m => m.vrrEnabled);
            this.subtitle = capable.length === 1
                ? capable[0].name : `${capable.length} displays`;
        } catch (e) {
            console.error('VRR Toggle: failed to read display state', e);
        }
    }

    async _apply(enable) {
        const skipConfirmation = !this._settings.get_boolean('confirm-display-change');
        const bypass = skipConfirmation ? this._bypassConfirmation() : null;
        try {
            await setVrr(enable);
        } catch (e) {
            console.error('VRR Toggle: failed to apply display config', e);
            Main.notifyError('VRR Toggle', e.message);
        } finally {
            bypass?.();
        }
        this._sync();
    }

    // Mutter asks the shell to confirm persistent display changes, which shows
    // the "Keep these display settings?" dialog. Block the shell's handler
    // while our own change is applied and confirm it ourselves. Returns a
    // function that confirms any pending change and restores the handler.
    _bypassConfirmation() {
        const wm = global.window_manager;
        const shellHandler = GObject.signal_handler_find(wm,
            {signalId: 'confirm-display-change'});
        let confirmRequested = false;
        const ourHandler = wm.connect('confirm-display-change',
            () => (confirmRequested = true));
        if (shellHandler)
            GObject.signal_handler_block(wm, shellHandler);

        return () => {
            wm.disconnect(ourHandler);
            if (confirmRequested)
                wm.complete_display_change(true);
            if (shellHandler)
                GObject.signal_handler_unblock(wm, shellHandler);
        };
    }

    destroy() {
        this._destroyed = true;
        this._unsubscribe?.();
        this._unsubscribe = null;
        super.destroy();
    }
});

export default class VrrToggleExtension extends Extension {
    enable() {
        this._indicator = new SystemIndicator();
        this._indicator.quickSettingsItems.push(new VrrToggle(this.getSettings()));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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

export function subscribeMonitorsChanged(callback) {
    const id = Gio.DBus.session.signal_subscribe(BUS_NAME, IFACE,
        'MonitorsChanged', OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
        () => callback());
    return () => Gio.DBus.session.signal_unsubscribe(id);
}

export async function getState() {
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

export function buildConfig(state, enable) {
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

export async function setVrr(enable) {
    const state = await getState();
    await call('ApplyMonitorsConfig', buildConfig(state, enable));
}

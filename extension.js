import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as Vrr from './vrr.js';

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
        this._unsubscribe = Vrr.subscribeMonitorsChanged(() => this._sync());
        this.connect('clicked', () => this._apply(this.checked));
        this._sync();
    }

    async _sync() {
        const id = ++this._syncId;
        try {
            const {monitors} = await Vrr.getState();
            if (id !== this._syncId)
                return;
            const capable = [...monitors.values()].filter(m => m.vrrCapable);
            this.visible = capable.length > 0;
            this.checked = capable.some(m => m.vrrEnabled);
            this.subtitle = capable.length === 1
                ? capable[0].name : `${capable.length} displays`;
        } catch (e) {
            console.error('VRR Toggler: failed to read display state', e);
        }
    }

    async _apply(enable) {
        const skipConfirmation = !this._settings.get_boolean('confirm-display-change');
        const bypass = skipConfirmation ? this._bypassConfirmation() : null;
        try {
            await Vrr.setVrr(enable);
        } catch (e) {
            console.error('VRR Toggler: failed to apply display config', e);
            Main.notifyError('VRR Toggler', e.message);
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
        this._syncId++;
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

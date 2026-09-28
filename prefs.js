import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class VrrTogglePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const row = new Adw.SwitchRow({
            title: 'Ask to Keep Display Settings',
            subtitle: 'Show the “Keep these display settings?” dialog after toggling VRR. ' +
                'When off, changes are kept immediately and won’t revert automatically ' +
                'if the display stops working.',
        });
        settings.bind('confirm-display-change', row, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const group = new Adw.PreferencesGroup();
        group.add(row);

        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
//
// Profiles page: manage NetBird profiles.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {Status, errorText} from '../netbird/parse.js';

/**
 * Create the Profiles page.
 *
 * @param {object} model - WindowModel
 * @param {Adw.PreferencesWindow} window - parent window
 * @returns {Adw.PreferencesPage}
 */
export function createProfilesPage(model, window) {
    const page = new Adw.PreferencesPage({
        title: 'Profiles',
        iconName: 'system-users-symbolic',
    });

    // Active profile selector
    const profileCombo = new Adw.ComboRow({
        subtitle: 'Choose which profile to use',
        title: 'Active Profile',
        use_markup: false,
    });

    let suppress = false;
    let profiles = [];
    let wasConnected = false;

    profileCombo.connect('notify::selected', async () => {
        if (suppress || profileCombo.selected < 0 || profileCombo.selected >= profiles.length)
            return;

        const selectedProfile = profiles[profileCombo.selected];
        if (!selectedProfile || selectedProfile.active)
            return;

        // Switch profile: select then up if it was connected
        const result = await model.run(['profile', 'select', selectedProfile.id]);
        if (!result.ok) {
            window.add_toast(new Adw.Toast({
                title: errorText(result, 'Profile switch failed'),
            }));
            return;
        }

        // If we were connected, reconnect with the new profile
        if (wasConnected)
            await model.run(['up']);
    });

    const profileGroup = new Adw.PreferencesGroup({
        title: 'Current Profile',
    });
    profileGroup.add(profileCombo);
    page.add(profileGroup);

    // Profile actions
    const actionsGroup = new Adw.PreferencesGroup({
        title: 'Profile Actions',
    });

    const addButton = createActionRow(
        'Add Profile',
        'Create a separate NetBird configuration',
        'list-add-symbolic',
        () => promptForName(window, 'Add Profile', 'Add', '', async name => {
            const result = await model.run(['profile', 'add', name]);
            if (!result.ok) {
                window.add_toast(new Adw.Toast({
                    title: errorText(result, 'Failed to add profile'),
                }));
            }
        }));

    const renameButton = createActionRow(
        'Rename Profile',
        'Change the current profile\'s display name',
        'document-edit-symbolic',
        () => {
            const selected = profileCombo.selected;
            if (selected < 0 || selected >= profiles.length)
                return;

            const currentName = profiles[selected].name;
            const profileId = profiles[selected].id;

            promptForName(window, 'Rename Profile', 'Rename', currentName, async name => {
                const result = await model.run(['profile', 'rename', profileId, name]);
                if (!result.ok) {
                    window.add_toast(new Adw.Toast({
                        title: errorText(result, 'Failed to rename profile'),
                    }));
                }
            });
        });

    const signOutButton = createActionRow(
        'Sign Out',
        'Remove this profile\'s authenticated session',
        'system-log-out-symbolic',
        () => {
            const selected = profileCombo.selected;
            if (selected < 0 || selected >= profiles.length)
                return;

            const profileId = profiles[selected].id;

            confirmAction(
                window,
                'Sign Out of This Profile?',
                'You will need to sign in again before reconnecting.',
                'Sign Out',
                'destructive',
                async () => {
                    const result = await model.run(['logout', '--profile', profileId]);
                    if (!result.ok) {
                        window.add_toast(new Adw.Toast({
                            title: errorText(result, 'Failed to sign out'),
                        }));
                    }
                });
        });

    actionsGroup.add(addButton);
    actionsGroup.add(renameButton);
    actionsGroup.add(signOutButton);
    page.add(actionsGroup);

    // Inactive profiles, each removable (the active one cannot be removed).
    const othersGroup = new Adw.PreferencesGroup({title: 'Other Profiles'});
    page.add(othersGroup);
    let otherRows = [];

    function rebuildOthers() {
        for (const row of otherRows)
            othersGroup.remove(row);
        otherRows = profiles.filter(p => !p.active).map(profile => {
            const row = new Adw.ActionRow({title: profile.name, use_markup: false});
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Remove Profile',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'error'],
            });
            remove.connect('clicked', () => confirmAction(
                window,
                `Remove “${profile.name}”?`,
                'This removes the local NetBird profile and cannot be undone.',
                'Remove',
                'destructive',
                async () => {
                    const result = await model.run(['profile', 'remove', profile.id]);
                    if (!result.ok) {
                        window.add_toast(new Adw.Toast({
                            title: errorText(result, 'Failed to remove profile'),
                        }));
                    }
                }));
            row.add_suffix(remove);
            othersGroup.add(row);
            return row;
        });
        othersGroup.visible = otherRows.length > 0;
    }
    let profilesKey = null;

    const signalId = model.connect('changed', state => {
        profiles = state.profiles;
        wasConnected = state.status === Status.CONNECTED;

        page.visible = !state.features.profilesDisabled;

        // Rebuild only on change: replacing the model every poll would reset
        // an open dropdown under the user.
        const key = JSON.stringify(profiles.map(p => [p.id, p.name, p.active]));
        if (key === profilesKey)
            return;
        profilesKey = key;

        suppress = true;
        profileCombo.model = Gtk.StringList.new(profiles.map(p => p.name));
        const activeIndex = profiles.findIndex(p => p.active);
        profileCombo.selected = activeIndex >= 0 ? activeIndex : 0;
        suppress = false;
        rebuildOthers();
    });

    page.connect('destroy', () => {
        model.disconnect(signalId);
    });

    return page;
}

function createActionRow(title, subtitle, iconName, callback, destructive = false) {
    const row = new Adw.ActionRow({
        subtitle,
        title,
        use_markup: false,
    });
    const button = new Gtk.Button({
        icon_name: iconName,
        tooltip_text: title,
        valign: Gtk.Align.CENTER,
    });
    if (destructive)
        button.add_css_class('destructive-action');
    button.connect('clicked', callback);
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

function promptForName(parent, heading, responseLabel, initialText, callback) {
    const entry = new Gtk.Entry({
        activates_default: true,
        hexpand: true,
        text: initialText,
    });
    const dialog = new Adw.AlertDialog({
        body: 'Profile names should be short and easy to recognize.',
        close_response: 'cancel',
        default_response: 'accept',
        extra_child: entry,
        focus_widget: entry,
        heading,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('accept', responseLabel);
    dialog.set_response_appearance('accept', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_response_enabled('accept', initialText.trim().length > 0);
    entry.connect('changed', () => dialog.set_response_enabled(
        'accept', entry.text.trim().length > 0));
    dialog.connect('response', (_dialog, response) => {
        if (response === 'accept')
            void callback(entry.text.trim());
    });
    dialog.present(parent);
}

function confirmAction(parent, heading, body, responseLabel, appearance, callback) {
    const dialog = new Adw.AlertDialog({
        body,
        close_response: 'cancel',
        default_response: 'cancel',
        heading,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('accept', responseLabel);
    dialog.set_response_appearance(
        'accept', appearance === 'destructive'
            ? Adw.ResponseAppearance.DESTRUCTIVE
            : Adw.ResponseAppearance.SUGGESTED);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'accept')
            void callback();
    });
    dialog.present(parent);
}

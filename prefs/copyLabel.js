// SPDX-License-Identifier: GPL-3.0-or-later
//
// Copy-to-clipboard label widget.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

/**
 * Create a label that copies its text to clipboard on click.
 *
 * @param {Adw.PreferencesWindow} window - parent window for toasts
 * @returns {{widget: Gtk.Label, setText: function(string): void}}
 */
export function createCopyLabel(window) {
    const label = new Gtk.Label({
        css_classes: ['dim-label', 'monospace'],
        cursor: Gdk.Cursor.new_from_name('pointer', null),
        ellipsize: Pango.EllipsizeMode.END,
        selectable: true,
        visible: false,
    });

    const actions = new Gio.SimpleActionGroup();
    const copy = new Gio.SimpleAction({name: 'copy'});
    copy.connect('activate', () => {
        label.get_clipboard().set(label.label);
        window.add_toast(new Adw.Toast({title: 'Copied to clipboard'}));
    });
    actions.add_action(copy);
    label.insert_action_group('address', actions);

    const menu = new Gio.Menu();
    menu.append('Copy', 'address.copy');
    const popover = Gtk.PopoverMenu.new_from_model(menu);
    popover.has_arrow = false;
    popover.set_parent(label);
    label.connect('destroy', () => popover.unparent());

    const selectAll = () => {
        label.grab_focus();
        label.select_region(0, -1);
    };
    const showMenu = (x, y) => {
        selectAll();
        popover.pointing_to = new Gdk.Rectangle({x, y, width: 1, height: 1});
        popover.popup();
    };

    // Capture phase runs before label's own gestures and stops them
    const click = new Gtk.GestureClick({
        button: 0,
        propagation_phase: Gtk.PropagationPhase.CAPTURE,
    });
    click.connect('pressed', (gesture, _presses, x, y) => {
        gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        if (gesture.get_current_button() === Gdk.BUTTON_SECONDARY) {
            showMenu(x, y);
        } else {
            selectAll();
            copy.activate(null);
        }
    });
    label.add_controller(click);

    const shortcuts = new Gtk.ShortcutController({
        propagation_phase: Gtk.PropagationPhase.CAPTURE,
    });
    shortcuts.add_shortcut(new Gtk.Shortcut({
        action: Gtk.NamedAction.new('address.copy'),
        trigger: Gtk.ShortcutTrigger.parse_string('<Control>c|<Control>Insert'),
    }));
    shortcuts.add_shortcut(new Gtk.Shortcut({
        action: Gtk.CallbackAction.new(() => {
            showMenu(label.get_width() / 2, label.get_height() / 2);
            return true;
        }),
        trigger: Gtk.ShortcutTrigger.parse_string('<Shift>F10|Menu'),
    }));
    label.add_controller(shortcuts);

    return {
        widget: label,
        setText(text) {
            label.label = text;
            label.tooltip_text = text ? `${text}\nClick to copy` : '';
            label.visible = Boolean(text);
        },
    };
}

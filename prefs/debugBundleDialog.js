// SPDX-License-Identifier: GPL-3.0-or-later
//
// Debug bundle dialog, adapted from netbirdio/gnome-extension
// prefs/debugBundleDialog.js; runs `netbird debug bundle`.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {errorText, parseDebugBundle} from '../netbird/parse.js';
import {createCopyLabel} from './copyLabel.js';

const NETBIRD_ISSUES_URL = 'https://github.com/netbirdio/netbird/issues';
const EXTENSION_ISSUES_URL = 'https://github.com/jfenal/gnome-shell-extension-netbird-cli/issues';

const REPORTING_GUIDANCE =
    'Before reporting a problem, check whether it also happens with the netbird ' +
    `CLI alone. If it does, <a href="${NETBIRD_ISSUES_URL}">report it to NetBird</a>. ` +
    'If it only happens in this extension, ' +
    `<a href="${EXTENSION_ISSUES_URL}">report it here</a>.`;

/**
 * Ask for bundle options, create the bundle, show the result.
 *
 * @param {object} model - WindowModel (uses model.cli, model.cancellable)
 * @param {Adw.PreferencesWindow} window - parent window
 */
export function presentDebugBundleDialog(model, window) {
    const options = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
    });
    const upload = new Adw.SwitchRow({
        active: false,
        title: 'Upload to NetBird',
        subtitle: 'Get an upload key to share with NetBird support',
    });
    const anonymize = new Adw.SwitchRow({
        active: true,
        title: 'Anonymize Sensitive Information',
        subtitle: 'Hide IP addresses, domains, and other sensitive values',
    });
    const systemInfo = new Adw.SwitchRow({
        active: true,
        title: 'Include System Information',
        subtitle: 'Include OS, kernel, network interfaces, and routes',
    });
    for (const row of [upload, anonymize, systemInfo])
        options.append(row);

    const dialog = new Adw.AlertDialog({
        heading: 'Create Debug Bundle',
        body: REPORTING_GUIDANCE,
        body_use_markup: true,
        close_response: 'cancel',
        default_response: 'create',
        extra_child: options,
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('create', 'Create');
    dialog.set_response_appearance('create', Adw.ResponseAppearance.SUGGESTED);
    dialog.connect('response', (_dialog, response) => {
        if (response === 'create')
            void create(model, window, {
                upload: upload.active,
                anonymize: anonymize.active,
                systemInfo: systemInfo.active,
            });
    });
    dialog.present(window);
}

async function create(model, window, options) {
    const toast = new Adw.Toast({
        timeout: 0,
        title: options.upload
            ? 'Creating and uploading the debug bundle…'
            : 'Creating the debug bundle…',
    });
    window.add_toast(toast);
    const result = await model.cli.debugBundle(options, model.cancellable);
    toast.dismiss();
    if (model.cancellable.is_cancelled())
        return;

    const bundle = parseDebugBundle(result.stdout, result.stderr);
    if (!bundle.path) {
        window.add_toast(new Adw.Toast({
            title: `Debug Bundle Could Not Be Created: ${errorText(result, 'unknown error')}`,
            timeout: 5,
        }));
        return;
    }
    presentResult(window, bundle, options.upload);
}

function presentResult(window, {path, uploadedKey, uploadError}, uploading) {
    // The daemon writes the bundle as root; this copies it where the user can attach it.
    const copyHome = `sudo install -m 600 -o "$USER" ${GLib.shell_quote(path)} ~/`;
    let heading = 'Debug Bundle Saved';
    let body = 'The NetBird service saved the bundle where only administrators ' +
        'can read it. To attach it to a report, copy it to your home folder (click to copy):';
    let text = copyHome;

    if (uploading && uploadedKey) {
        heading = 'Debug Bundle Uploaded';
        body = 'Share this upload key with NetBird support (click to copy). ' +
            'A local copy was also saved.';
        text = uploadedKey;
    } else if (uploading) {
        body = `Upload failed: ${uploadError || 'unknown error'}. The bundle is still ` +
            'saved locally, where only administrators can read it. To attach it to a ' +
            'report, copy it to your home folder (click to copy):';
    }

    const copy = createCopyLabel(window);
    copy.setText(text);
    // Commands and keys are long: wrap instead of the address-style ellipsis.
    copy.widget.ellipsize = Pango.EllipsizeMode.NONE;
    copy.widget.wrap = true;
    copy.widget.wrap_mode = Pango.WrapMode.CHAR;
    const dialog = new Adw.AlertDialog({
        heading,
        body,
        close_response: 'close',
        extra_child: copy.widget,
    });
    dialog.add_response('close', 'Close');
    dialog.present(window);
}

// Screenshot helper only: enables unsafe mode in the throwaway nested shell
// so tools/screenshot/run.sh can drive the UI via org.gnome.Shell.Eval.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class UnsafeModeHelper extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}

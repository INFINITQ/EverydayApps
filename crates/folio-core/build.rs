// Generates `allow-*` permissions for every command of the internal `folio` plugin.
// Apps grant them through `folio:default` (see permissions/default.toml).
const COMMANDS: &[&str] = &[
    "app_ready",
    "system_info",
    "pick_open",
    "pick_save",
    "read",
    "save",
    "release",
    "pick_folder",
    "save_into_folder",
    "release_folder",
    "open_link",
    "set_fullscreen",
    "take_pending",
    "backups_usage",
    "backups_clear",
    "settings_get",
    "settings_set",
    "recent_list",
    "recent_open",
    "recent_remove",
    "recent_clear",
    "view_state_get",
    "view_state_set",
    "recovery_put",
    "recovery_list",
    "recovery_read",
    "recovery_drop",
    "recovery_origin",
    "secure_put",
    "secure_get",
    "secure_delete",
    "secure_keys",
    "system",
    "network_lock",
    "caption_maximize_rect",
    "debug_crash_renderer",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}

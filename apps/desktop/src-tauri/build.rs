fn main() {
    // tauri.conf.json maps packages/claude-plugin/{skills,agents,schemas,.claude-plugin}
    // into the bundled plugin/ resource directory. Cargo doesn't watch those paths
    // by default, so editing a SKILL.md used to leave target/*/plugin/ stale until
    // a clean rebuild. Declaring them here makes cargo re-run this build script —
    // and therefore `tauri_build::build()`'s resource pipeline — whenever anything
    // under the plugin source tree changes.
    println!("cargo:rerun-if-changed=../../../packages/claude-plugin");

    tauri_build::build();
}

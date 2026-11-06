fn main() {
    // 把 anyhow 的错误链打全，方便定位（正式发布时可以只留 tauri_build::build()）
    if let Err(err) = tauri_build::try_build(tauri_build::Attributes::new()) {
        eprintln!("BUILD_SCRIPT_ERROR: {err:?}");
        eprintln!("---- chain ----");
        for (i, cause) in err.chain().enumerate() {
            eprintln!("  [{i}] {cause}");
        }
        std::process::exit(1);
    }
}

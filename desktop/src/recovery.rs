//! Local recovery. Call mutations while holding AppState::writes.
//! No purge, network, configuration or raw-asset backup. External processes are
//! outside the app write lock; each copy checks size/mtime before and after.
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_BACKUPS: usize = 100;
const MAX_STORED: u64 = 2 * 1024 * 1024 * 1024;
static SERIAL: AtomicU64 = AtomicU64::new(0);
fn err(e: impl std::fmt::Display) -> String { format!("E_RECOVERY_IO: {e}") }
fn stamp() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64() }
fn id() -> String { format!("r{:x}-{:x}-{:x}", (stamp()*1_000_000.0) as u64, std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)) }
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str, String> { v[k].as_str().ok_or_else(|| "E_RECOVERY_MANIFEST".into()) }
fn rel_path(rel: &str) -> Result<&Path, String> {
    if rel.is_empty() || rel.len() > 2048 || rel.contains('\\') || rel.chars().any(|c| c.is_control() || ":*?\"<>|".contains(c)) || rel.split('/').any(|s| {
        let device = s.split('.').next().unwrap_or("").to_ascii_uppercase();
        s.is_empty() || s == "." || s == ".." || s.ends_with('.') || s.ends_with(' ') || ["CON","PRN","AUX","NUL"].contains(&device.as_str()) || ((device.starts_with("COM") || device.starts_with("LPT")) && device.len()==4 && matches!(device.as_bytes()[3],b'1'..=b'9'))
    }) { return Err("E_RECOVERY_PATH".into()); }
    let p = Path::new(rel);
    if !p.components().all(|c| matches!(c, Component::Normal(_))) { return Err("E_RECOVERY_PATH".into()); }
    Ok(p)
}
fn basename(s: &str) -> Result<(), String> { rel_path(s)?; if s.contains('/') || s.len() > 240 { return Err("E_RECOVERY_ID".into()); } Ok(()) }
fn reparse(m: &fs::Metadata) -> bool {
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; m.file_attributes() & 0x400 != 0 }
    #[cfg(not(windows))] { m.file_type().is_symlink() }
}
/// Check every existing component, including Windows junction/reparse points.
pub(crate) fn checked(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel_path(rel)?;
    let base = fs::canonicalize(root).map_err(err)?;
    let mut p = base.clone();
    for c in rel.components() {
        p.push(c.as_os_str());
        match fs::symlink_metadata(&p) {
            Ok(m) => { if reparse(&m) || !fs::canonicalize(&p).map_err(err)?.starts_with(&base) { return Err("E_RECOVERY_PATH".into()); } }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(err(e)),
        }
    }
    Ok(p)
}
fn directory(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = checked(root, rel)?;
    fs::create_dir_all(&p).map_err(err)?;
    checked(root, rel)
}
fn read_json(p: &Path) -> Result<Value, String> {
    let m = fs::metadata(p).map_err(err)?;
    if m.len() > MAX_FILE { return Err("E_RECOVERY_LIMIT".into()); }
    serde_json::from_reader(File::open(p).map_err(err)?).map_err(err)
}
fn write_new(p: &Path, data: &[u8]) -> Result<(), String> {
    let mut f = OpenOptions::new().write(true).create_new(true).open(p).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { "E_RECOVERY_EXISTS".into() } else { err(e) })?;
    f.write_all(data).map_err(err)?; f.sync_all().map_err(err)
}
fn copy_new(src: &Path, dst: &Path, limit: u64) -> Result<u64, String> {
    let before = fs::metadata(src).map_err(err)?;
    if !before.is_file() || before.len() > limit { return Err("E_RECOVERY_LIMIT".into()); }
    let mut input = File::open(src).map_err(err)?;
    let mut out = OpenOptions::new().write(true).create_new(true).open(dst).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { "E_RECOVERY_EXISTS".into() } else { err(e) })?;
    let result = (|| {
        let n = std::io::copy(&mut Read::by_ref(&mut input).take(limit + 1), &mut out).map_err(err)?;
        let after = fs::metadata(src).map_err(err)?;
        if n != before.len() || n > limit || after.len() != before.len() || after.modified().ok() != before.modified().ok() { return Err("E_RECOVERY_CHANGED".into()); }
        if let Ok(t) = before.modified() { out.set_times(fs::FileTimes::new().set_modified(t)).map_err(err)?; }
        out.sync_all().map_err(err)?;
        Ok(n)
    })();
    if result.is_err() { drop(out); let _ = fs::remove_file(dst); }
    result
}
fn trash_rel(kind: &str) -> Result<&'static str, String> { match kind { "note" => Ok("灵感盒/.trash"), "asset" => Ok(".data/trash"), _ => Err("E_RECOVERY_KIND".into()) } }
fn allowed(kind: &str, rel: &str) -> bool {
    rel_path(rel).is_ok() && !rel.split('/').any(|p| p.starts_with('.') || p.eq_ignore_ascii_case("backups") || p.eq_ignore_ascii_case("node_modules")) && match kind { "note" => Path::new(rel).extension().is_some_and(|x| x.eq_ignore_ascii_case("md")), "asset" => rel.starts_with("assets/"), _ => false }
}
/// Manifest is committed before removing the source; failures leave the source intact.
pub(crate) fn trash(root: &Path, rel: &str, kind: &str, metadata: Value) -> Result<PathBuf, String> {
    if !allowed(kind, rel) { return Err("E_RECOVERY_PATH".into()); }
    let src = checked(root, rel)?;
    let dir = directory(root, trash_rel(kind)?)?;
    let manifests = directory(&dir, ".manifests")?;
    let key = id();
    let dst = checked(&dir, &key)?;
    // Assets may exceed the backup limit; trash never truncates them.
    let size = fs::metadata(&src).map_err(err)?.len();
    copy_new(&src, &dst, size)?;
    let manifest = json!({"version":1,"id":key,"kind":kind,"name":Path::new(rel).file_name().unwrap().to_string_lossy(),"original_path":rel,"deleted_at":stamp(),"size":size,"metadata":metadata});
    if let Err(e) = write_new(&manifests.join(format!("{key}.json")), manifest.to_string().as_bytes()) { let _ = fs::remove_file(&dst); return Err(e); }
    fs::remove_file(&src).map_err(err)?;
    Ok(dst)
}
fn trash_items(root: &Path, kind: &str) -> Result<Vec<Value>, String> {
    if !root.is_dir() { return Ok(vec![]); }
    let dir = checked(root, trash_rel(kind)?)?;
    if !dir.exists() { return Ok(vec![]); }
    let mut items = vec![];
    for entry in fs::read_dir(&dir).map_err(err)? {
        if items.len() >= MAX_FILES { return Err("E_RECOVERY_LIMIT".into()); }
        let entry = entry.map_err(err)?;
        let key = entry.file_name().to_string_lossy().to_string();
        if basename(&key).is_err() || key.starts_with('.') { continue; }
        let p = checked(&dir, &key)?;
        let m = fs::metadata(&p).map_err(err)?;
        if !m.is_file() { continue; }
        let manifest = checked(&dir, &format!(".manifests/{key}.json"))?;
        if manifest.exists() {
            let mut v = read_json(&manifest)?;
            if text(&v,"id")? != key || text(&v,"kind")? != kind || !allowed(kind,text(&v,"original_path")?) { return Err("E_RECOVERY_MANIFEST".into()); }
            v.as_object_mut().unwrap().remove("metadata"); v["legacy"] = json!(false); v["size"] = json!(m.len()); items.push(v);
        } else {
            items.push(json!({"id":key,"kind":kind,"name":key,"original_path":Value::Null,"deleted_at":m.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs_f64()),"size":m.len(),"legacy":true}));
        }
    }
    Ok(items)
}
pub(crate) fn list(vault: &Path, library: &Path) -> Result<Value, String> {
    let mut items = trash_items(vault,"note")?; items.extend(trash_items(library,"asset")?);
    items.sort_by(|a,b| b["deleted_at"].as_f64().unwrap_or(0.0).total_cmp(&a["deleted_at"].as_f64().unwrap_or(0.0)));
    Ok(json!({"items":items}))
}
pub(crate) fn restore(root: &Path, key: &str, kind: &str) -> Result<Value, String> {
    basename(key)?;
    let dir = checked(root, trash_rel(kind)?)?;
    let src = checked(&dir,key)?;
    if !src.is_file() { return Err("E_RECOVERY_NOT_FOUND".into()); }
    let mp = checked(&dir,&format!(".manifests/{key}.json"))?;
    let manifest = if mp.exists() { Some(read_json(&mp)?) } else { None };
    let rel = if let Some(v) = &manifest {
        if text(v,"id")? != key || text(v,"kind")? != kind || !allowed(kind,text(v,"original_path")?) { return Err("E_RECOVERY_MANIFEST".into()); }
        text(v,"original_path")?.to_string()
    } else { format!("{}/{}",if kind == "note" { "灵感盒/恢复的笔记" } else { "assets/uploads/recovered" },key) };
    let dst = checked(root,&rel)?;
    if fs::symlink_metadata(&dst).is_ok() { return Err("E_RECOVERY_EXISTS".into()); }
    if let Some(parent) = Path::new(&rel).parent().filter(|p| !p.as_os_str().is_empty()) { directory(root,&parent.to_string_lossy())?; }
    copy_new(&src,&dst,fs::metadata(&src).map_err(err)?.len())?;
    if kind == "asset" {
        if let Some(v) = &manifest {
            if let Err(e) = super::assets::restore_metadata(root,&rel,&v["metadata"]) { let _ = fs::remove_file(&dst); return Err(e); }
        }
    }
    // Metadata failure leaves the trash copy available for retry.
    fs::remove_file(&src).map_err(err)?;
    if manifest.is_some() { fs::remove_file(mp).map_err(err)?; }
    Ok(json!({"ok":true,"path":rel}))
}

fn scope() -> Value { json!({"included":["vault/**/*.md (non-hidden directories)","library/.data/asset-tags.json","library/.data/asset-notes.json","app/canvas.json"],"excluded":["hidden directories","backups","node_modules","raw assets","secrets","configuration"],"mode":"additive-missing-files-only","limits":{"files":MAX_FILES,"bytes":MAX_BYTES,"file_bytes":MAX_FILE,"backups":MAX_BACKUPS,"stored_bytes":MAX_STORED}}) }
fn walk_md(root: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) -> Result<(),String> {
    if depth > 64 { return Err("E_RECOVERY_LIMIT".into()); }
    for e in fs::read_dir(dir).map_err(err)? {
        let e=e.map_err(err)?; let name=e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("backups") || name.eq_ignore_ascii_case("node_modules") { continue; }
        let rel=e.path().strip_prefix(root).map_err(err)?.to_string_lossy().replace('\\',"/");
        let p=checked(root,&rel)?; let m=fs::metadata(&p).map_err(err)?;
        if m.is_dir() { walk_md(root,&p,out,depth+1)?; }
        else if m.is_file() && allowed("note",&rel) { out.push(rel); if out.len()>MAX_FILES { return Err("E_RECOVERY_LIMIT".into()); } }
    } Ok(())
}
fn backup_dir(app: &Path) -> Result<PathBuf,String> { fs::create_dir_all(app).map_err(err)?; directory(app,"backups") }
// Count hidden incomplete copies too: failed snapshots cannot bypass disk bounds.
fn storage_usage(root: &Path, dir: &Path, count: &mut usize, bytes: &mut u64, depth: usize) -> Result<(),String> {
    if depth > 68 { return Err("E_RECOVERY_LIMIT".into()); }
    for e in fs::read_dir(dir).map_err(err)? {
        *count += 1;
        if *count > 100_000 { return Err("E_RECOVERY_LIMIT".into()); }
        let e=e.map_err(err)?;
        let rel=e.path().strip_prefix(root).map_err(err)?.to_string_lossy().replace('\\',"/");
        let p=checked(root,&rel)?; let m=fs::metadata(&p).map_err(err)?;
        if m.is_dir() { storage_usage(root,&p,count,bytes,depth+1)?; }
        else if m.is_file() { *bytes=bytes.saturating_add(m.len()); if *bytes > MAX_STORED { return Err("E_RECOVERY_LIMIT".into()); } }
    }
    Ok(())
}
fn manifest(dir: &Path, key: &str) -> Result<Value,String> {
    basename(key)?;
    let p=checked(dir,&format!("{key}/manifest.json"))?;
    let v=read_json(&p)?;
    if text(&v,"id")? != key || v["version"] != 1 || !v["entries"].is_array() { return Err("E_RECOVERY_MANIFEST".into()); } Ok(v)
}
pub(crate) fn backup_list(app: &Path) -> Result<Value,String> {
    let dir=backup_dir(app)?; let mut items=vec![];
    for e in fs::read_dir(&dir).map_err(err)? {
        let e=e.map_err(err)?; let key=e.file_name().to_string_lossy().to_string();
        if key.starts_with('.') { continue; }
        if items.len() >= MAX_BACKUPS { return Err("E_RECOVERY_LIMIT".into()); }
        let v=manifest(&dir,&key)?;
        items.push(json!({"id":key,"path":checked(&dir,&key)?.to_string_lossy(),"created_at":v["created_at"],"files":v["files"],"bytes":v["bytes"],"scope":v["scope"]}));
    }
    items.sort_by(|a,b| b["created_at"].as_f64().unwrap_or(0.0).total_cmp(&a["created_at"].as_f64().unwrap_or(0.0)));
    Ok(json!({"items":items}))
}
pub(crate) fn backup_create(vault: &Path, library: &Path, app: &Path) -> Result<Value,String> {
    let dir=backup_dir(app)?;
    let previous=backup_list(app)?;
    let existing=previous["items"].as_array().unwrap();
    let mut stored=0; let mut stored_files=0;
    storage_usage(&dir,&dir,&mut stored_files,&mut stored,0)?;
    let folder_count=fs::read_dir(&dir).map_err(err)?.count();
    if existing.len()>=MAX_BACKUPS || folder_count>=MAX_BACKUPS { return Err("E_RECOVERY_LIMIT".into()); }
    let mut inputs:Vec<(&str,String)>=vec![];
    let mut notes=vec![];
    if vault.is_dir() { let root=fs::canonicalize(vault).map_err(err)?; walk_md(&root,&root,&mut notes,0)?; }
    inputs.extend(notes.into_iter().map(|r|("vault",r)));
    for rel in [".data/asset-tags.json",".data/asset-notes.json"] { if library.is_dir() && checked(library,rel)?.exists() { inputs.push(("library",rel.into())); } }
    if checked(app,"canvas.json")?.exists() { inputs.push(("app","canvas.json".into())); }
    if inputs.len()>MAX_FILES { return Err("E_RECOVERY_LIMIT".into()); }
    let key=id(); let pending=format!(".pending-{key}");
    let dest=checked(&dir,&pending)?; fs::create_dir(&dest).map_err(err)?;
    let result=(|| {
        let mut entries=vec![]; let mut bytes=0u64;
        for (area,rel) in &inputs {
            let root=match *area { "vault"=>vault,"library"=>library,_=>app };
            let src=checked(root,rel)?;
            let size=fs::metadata(&src).map_err(err)?.len();
            if size>MAX_FILE || bytes.saturating_add(size)>MAX_BYTES || stored.saturating_add(bytes).saturating_add(size).saturating_add(MAX_FILE)>MAX_STORED { return Err("E_RECOVERY_LIMIT".into()); }
            let stored_rel=format!("{area}/{rel}");
            let target=checked(&dest,&stored_rel)?;
            directory(&dest,&Path::new(&stored_rel).parent().unwrap().to_string_lossy())?;
            bytes=bytes.checked_add(copy_new(&src,&target,MAX_FILE)?).ok_or("E_RECOVERY_LIMIT")?;
            if bytes>MAX_BYTES || stored.saturating_add(bytes)>MAX_STORED { return Err("E_RECOVERY_LIMIT".into()); }
            entries.push(json!({"area":area,"path":rel,"size":fs::metadata(&target).map_err(err)?.len()}));
        }
        let v=json!({"version":1,"id":key,"created_at":stamp(),"files":entries.len(),"bytes":bytes,"scope":scope(),"entries":entries});
        write_new(&dest.join("manifest.json"),v.to_string().as_bytes())?;
        let final_path=checked(&dir,&key)?;
        fs::rename(&dest,&final_path).map_err(err)?;
        Ok(json!({"ok":true,"id":key,"path":final_path.to_string_lossy(),"files":inputs.len(),"bytes":bytes,"scope":scope()}))
    })();
    // Incomplete copies stay hidden and are never offered for restore. No purge.
    result
}
pub(crate) fn backup_restore(vault: &Path, library: &Path, app: &Path, key: &str) -> Result<Value,String> {
    let dir=backup_dir(app)?; let v=manifest(&dir,key)?;
    let entries=v["entries"].as_array().unwrap();
    if entries.len()>MAX_FILES { return Err("E_RECOVERY_LIMIT".into()); }
    let snapshot=checked(&dir,key)?;
    let mut planned=vec![]; let mut total=0u64;
    // Validate entire manifest and all sources before touching destination files.
    for e in entries {
        let area=text(e,"area")?; let rel=text(e,"path")?;
        let root=match area { "vault" if allowed("note",rel)=>vault, "library" if [".data/asset-tags.json",".data/asset-notes.json"].contains(&rel)=>library,"app" if rel=="canvas.json"=>app,_=>return Err("E_RECOVERY_MANIFEST".into()) };
        let src=checked(&snapshot,&format!("{area}/{rel}"))?;
        let n=fs::metadata(&src).map_err(err)?.len();
        total=total.checked_add(n).ok_or("E_RECOVERY_LIMIT")?;
        if n>MAX_FILE || total>MAX_BYTES || e["size"].as_u64()!=Some(n) { return Err("E_RECOVERY_LIMIT".into()); }
        let dst=checked(root,rel)?;
        planned.push((area.to_string(),rel.to_string(),src,dst,root));
    }
    let mut restored=vec![]; let mut skipped=vec![]; let mut conflicts=vec![]; let mut bytes=0;
    for (area,rel,src,dst,root) in planned {
        if fs::symlink_metadata(&dst).is_ok() { skipped.push(json!({"area":area,"path":rel})); conflicts.push(json!({"area":area,"path":rel,"code":"E_RECOVERY_EXISTS"})); continue; }
        if let Some(parent) = Path::new(&rel).parent().filter(|p| !p.as_os_str().is_empty()) {
            directory(root, &parent.to_string_lossy())?;
        }
        match copy_new(&src,&dst,MAX_FILE) {
            Ok(n)=> { bytes+=n; restored.push(json!({"area":area,"path":rel})); },
            Err(e) if e=="E_RECOVERY_EXISTS"=> { skipped.push(json!({"area":area,"path":rel})); conflicts.push(json!({"area":area,"path":rel,"code":e})); },
            Err(e)=>return Err(e),
        }
    }
    Ok(json!({"ok":true,"id":key,"files":restored.len(),"bytes":bytes,"restored":restored,"skipped":skipped,"conflicts":conflicts,"scope":v["scope"]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn reject_paths() { for p in ["../x","/tmp/x","C:/x","a\\b","a/../b","a//b","a:stream","a./x"] { assert!(rel_path(p).is_err(),"{p}"); } assert!(basename("a/b").is_err()); }
    #[test] fn legacy_and_asset_metadata() {
        let base=std::env::temp_dir().join(id()); fs::create_dir(&base).unwrap();
        directory(&base,"灵感盒/.trash").unwrap();
        fs::write(base.join("灵感盒/.trash/old.md"),"legacy").unwrap();
        let items=trash_items(&base,"note").unwrap(); assert_eq!(items[0]["legacy"],true); assert!(items[0]["original_path"].is_null());
        assert_eq!(restore(&base,"old.md","note").unwrap()["path"],"灵感盒/恢复的笔记/old.md");
        directory(&base,"assets/uploads").unwrap();
        fs::write(base.join("assets/uploads/a.png"),b"asset").unwrap();
        super::super::assets::set_tags(&base,"assets/uploads/a.png",&["original".into()]).unwrap();
        super::super::assets::set_note(&base,"assets/uploads/a.png","keep note").unwrap();
        let p=super::super::assets::delete_to_trash(&base,"assets/uploads/a.png").unwrap();
        let key=Path::new(&p).file_name().unwrap().to_str().unwrap();
        restore(&base,key,"asset").unwrap();
        assert_eq!(super::super::assets::load_tags(&base)["assets/uploads/a.png"],vec!["original"]);
        assert_eq!(super::super::assets::load_notes(&base)["assets/uploads/a.png"],"keep note");
        fs::remove_dir_all(base).unwrap();
    }
    #[test] fn recovery_and_backup_are_additive() {
        let base=std::env::temp_dir().join(id()); fs::create_dir(&base).unwrap();
        for d in ["vault","library","app"] { fs::create_dir(base.join(d)).unwrap(); }
        let vault=base.join("vault"); let lib=base.join("library"); let app=base.join("app");
        fs::write(vault.join("test.md"),"---\ntags: [kept]\n---\nhello").unwrap();
        let p=trash(&vault,"test.md","note",Value::Null).unwrap(); let key=p.file_name().unwrap().to_str().unwrap();
        fs::write(vault.join("test.md"),"existing").unwrap(); assert_eq!(restore(&vault,key,"note").unwrap_err(),"E_RECOVERY_EXISTS"); assert!(p.exists());
        fs::remove_file(vault.join("test.md")).unwrap(); restore(&vault,key,"note").unwrap();
        fs::write(app.join("canvas.json"),"{}").unwrap();
        let b=backup_create(&vault,&lib,&app).unwrap(); fs::remove_file(vault.join("test.md")).unwrap();
        let r=backup_restore(&vault,&lib,&app,b["id"].as_str().unwrap()).unwrap(); assert_eq!(r["files"],1); assert_eq!(r["conflicts"].as_array().unwrap().len(),1);
        assert!(fs::read_to_string(vault.join("test.md")).unwrap().contains("tags: [kept]"));
        fs::remove_dir_all(base).unwrap();
    }
}

//! The native shell.
//!
//! Everything the app does happens in the webview: PDFium, Tesseract and
//! pdf-lib all run as WASM or JavaScript. This process exists to give that
//! webview a window, a place on disk, and a native save dialog — nothing else
//! belongs here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The webview ignores `<a download>`, so saving a document has to go
        // through the OS file dialog and a real write.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the PDF Workbench window");
}

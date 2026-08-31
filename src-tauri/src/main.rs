// Prevents a console window opening alongside the app on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pdf_workbench_lib::run()
}

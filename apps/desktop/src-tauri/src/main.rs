// Без консольного окна рядом с игрой в релизе.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

// Игра сама полноэкранный режим не включает, а `requestFullscreen` в WebView2 растягивает
// страницу лишь внутри окна. Поэтому клавиши ловим в странице, а разворачиваем само окно.
const FULLSCREEN_KEYS: &str = r#"
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11' || (e.altKey && e.key === 'Enter')) {
    e.preventDefault();
    window.__TAURI_INTERNALS__.invoke('toggle_fullscreen');
  }
}, true);
"#;

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) {
    let on = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!on);
}

fn main() {
    tauri::Builder::default()
        // Один экземпляр: второй запуск поднимает открытое окно, а не делит с ним сейв.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![toggle_fullscreen])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Star Elite")
                .inner_size(1600.0, 900.0)
                .center()
                .initialization_script(FULLSCREEN_KEYS)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Star Elite: не удалось запустить окно");
}

//! 本地 HTML 使用独立 HTTP origin，防止子 iframe 获得应用来源的 IPC 权限。
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::State;

pub struct HtmlPreviewState {
    port: u16,
    roots: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl HtmlPreviewState {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let roots = Arc::new(Mutex::new(HashMap::new()));
        let registry = roots.clone();
        std::thread::spawn(move || {
            // 每次连接都带超时，有限并发防止页面大量慢连接占满线程。
            let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            for connection in listener.incoming() {
                let Ok(stream) = connection else { break };
                if active.load(std::sync::atomic::Ordering::Relaxed) >= 16 {
                    continue;
                }
                active.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let registry = registry.clone();
                let active = active.clone();
                std::thread::spawn(move || {
                    let _ = serve(stream, port, &registry);
                    active.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                });
            }
        });
        Ok(Self { port, roots })
    }

    fn register(&self, file_path: &str) -> Result<String, String> {
        let file = Path::new(file_path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !file.is_file() || !is_html_path(&file) {
            return Err("请选择 HTML 文件".into());
        }
        let directory = file.parent().ok_or("文件目录无效")?.to_path_buf();
        let mut roots = self.roots.lock().map_err(|e| e.to_string())?;
        let token = roots
            .iter()
            .find(|(_, root)| **root == directory)
            .map(|(token, _)| token.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        roots.insert(token.clone(), directory);
        let name = file.file_name().ok_or("文件名无效")?.to_string_lossy();
        Ok(format!(
            "http://127.0.0.1:{}/t/{}/{}",
            self.port,
            token,
            utf8_percent_encode(&name, NON_ALPHANUMERIC)
        ))
    }
}

pub fn is_html_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm"))
}

fn resolve_path(target: &str, roots: &HashMap<String, PathBuf>) -> Option<PathBuf> {
    let path = target.split('?').next()?;
    let rest = path.strip_prefix("/t/")?;
    let (token, encoded) = rest.split_once('/')?;
    let root = roots.get(token)?;
    let decoded = percent_decode_str(encoded).decode_utf8().ok()?;
    if decoded.is_empty() || decoded.contains(['\\', '\0', ':']) {
        return None;
    }
    let relative = Path::new(decoded.as_ref());
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    let file = root.join(relative).canonicalize().ok()?;
    (file.starts_with(root) && file.is_file()).then_some(file)
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn serve(
    mut stream: TcpStream,
    port: u16,
    roots: &Mutex<HashMap<String, PathBuf>>,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new((&stream).take(16_384));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let parts: Vec<_> = line.split_whitespace().collect();
    if parts.len() != 3 {
        return Ok(());
    }
    let method = parts[0].to_string();
    let target = parts[1].to_string();
    let mut valid_host = false;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("host") {
                valid_host = value.trim() == format!("127.0.0.1:{port}");
            }
        }
    }
    let (status, content_type, body) = if !valid_host {
        ("403 Forbidden", "text/plain", Vec::new())
    } else if method != "GET" && method != "HEAD" {
        ("405 Method Not Allowed", "text/plain", Vec::new())
    } else {
        let file = roots
            .lock()
            .ok()
            .and_then(|roots| resolve_path(&target, &roots));
        match file.and_then(|file| std::fs::read(&file).ok().map(|bytes| (file, bytes))) {
            Some((file, bytes)) => ("200 OK", mime(&file), bytes),
            None => ("404 Not Found", "text/plain", Vec::new()),
        }
    };
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n\r\n", body.len())?;
    if method != "HEAD" {
        stream.write_all(&body)?;
    }
    Ok(())
}

#[tauri::command]
pub fn ensure_html_preview(
    state: State<'_, HtmlPreviewState>,
    file_path: String,
) -> Result<String, String> {
    state.register(&file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serves_html_and_relative_resources_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("中文.html"), "<html>hello</html>").unwrap();
        std::fs::write(dir.join("style.css"), "body{}").unwrap();
        let state = HtmlPreviewState::start().unwrap();
        let url = state
            .register(dir.join("中文.html").to_str().unwrap())
            .unwrap();
        let url = url::Url::parse(&url).unwrap();
        let roots = state.roots.lock().unwrap();
        assert!(resolve_path(url.path(), &roots).is_some());
        let base = url.path().rsplit_once('/').unwrap().0;
        assert!(resolve_path(&format!("{base}/style.css?version=1"), &roots).is_some());
        for tail in [
            "../secret",
            "%2e%2e/secret",
            "%2fetc/passwd",
            "%5csecret",
            "C%3a/secret",
        ] {
            assert!(resolve_path(&format!("{base}/{tail}"), &roots).is_none());
        }
        drop(roots);
        for (method, expected) in [
            ("GET", "200 OK"),
            ("HEAD", "200 OK"),
            ("POST", "405 Method Not Allowed"),
        ] {
            let mut stream = TcpStream::connect(("127.0.0.1", state.port)).unwrap();
            write!(
                stream,
                "{method} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
                url.path(),
                state.port
            )
            .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.contains(expected));
            if method == "HEAD" {
                assert!(!response.contains("<html>"));
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}

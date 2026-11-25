use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

struct Session {
    owner: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalState {
    pub fn close_for_window(&self, label: Option<&str>) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        let ids: Vec<_> = sessions
            .iter()
            .filter(|(_, session)| label.map_or(true, |label| session.owner == label))
            .map(|(id, _)| id.clone())
            .collect();
        let removed: Vec<_> = ids.iter().filter_map(|id| sessions.remove(id)).collect();
        drop(sessions);
        for mut session in removed {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
    }
}

pub fn resolve_terminal_cwd(requested: Option<&str>, home: &Path) -> PathBuf {
    requested
        .filter(|cwd| Path::new(cwd).is_dir())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.to_path_buf())
}

fn resolve_shell() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("COMSPEC")
            .map(PathBuf::from)
            .unwrap_or_else(|| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|shell| shell.is_file())
            .or_else(|| {
                ["/bin/zsh", "/bin/bash", "/bin/sh"]
                    .iter()
                    .map(PathBuf::from)
                    .find(|shell| shell.is_file())
            })
            .unwrap_or_else(|| "/bin/sh".into())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Exit {
    session_id: String,
}

#[tauri::command]
pub async fn terminal_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let cwd = resolve_terminal_cwd(cwd.as_deref(), &home);
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<TerminalState>();
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&session_id)
            || sessions.values().any(|session| session.owner == owner)
        {
            return Err("当前窗口已有终端会话".to_string());
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut command = CommandBuilder::new(resolve_shell());
        #[cfg(not(windows))]
        command.arg("-l");
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        sessions.insert(
            session_id.clone(),
            Session {
                owner: owner.clone(),
                master: pair.master,
                writer,
                child,
            },
        );
        drop(sessions);
        let monitor_app = app.clone();
        let monitor_id = session_id.clone();
        let monitor_owner = owner.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let Some(state) = monitor_app.try_state::<TerminalState>() else {
                return;
            };
            let Ok(mut sessions) = state.sessions.lock() else {
                return;
            };
            let Some(session) = sessions.get_mut(&monitor_id) else {
                return;
            };
            match session.child.try_wait() {
                Ok(None) => continue,
                _ => {
                    let removed = sessions.remove(&monitor_id);
                    drop(sessions);
                    if let Some(mut session) = removed {
                        let _ = session.child.kill();
                        let _ = session.child.wait();
                    }
                    let _ = monitor_app.emit_to(
                        &monitor_owner,
                        "terminal:exit",
                        Exit {
                            session_id: monitor_id,
                        },
                    );
                    return;
                }
            }
        });
        let app = app.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(size) => {
                        if app
                            .emit_to(
                                &owner,
                                "terminal:output",
                                Output {
                                    session_id: session_id.clone(),
                                    data: STANDARD.encode(&buffer[..size]),
                                },
                            )
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            if let Some(state) = app.try_state::<TerminalState>() {
                let removed = state
                    .sessions
                    .lock()
                    .ok()
                    .and_then(|mut sessions| sessions.remove(&session_id));
                if let Some(mut session) = removed {
                    let _ = session.child.kill();
                    let _ = session.child.wait();
                }
            }
            let _ = app.emit_to(&owner, "terminal:exit", Exit { session_id });
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn terminal_write<R: Runtime>(
    state: State<'_, TerminalState>,
    window: WebviewWindow<R>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .filter(|session| session.owner == window.label())
        .ok_or("终端会话不存在")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize<R: Runtime>(
    state: State<'_, TerminalState>,
    window: WebviewWindow<R>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .filter(|session| session.owner == window.label())
        .ok_or("终端会话不存在")?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_close<R: Runtime>(
    state: State<'_, TerminalState>,
    window: WebviewWindow<R>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if sessions
        .get(&session_id)
        .is_some_and(|session| session.owner != window.label())
    {
        return Err("终端属于其他窗口".into());
    }
    let removed = sessions.remove(&session_id);
    drop(sessions);
    if let Some(mut session) = removed {
        let _ = session.child.kill();
        session.child.wait().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cwd_uses_workspace_and_falls_back_to_home() {
        let home = std::env::temp_dir();
        assert_eq!(resolve_terminal_cwd(None, &home), home);
        assert_eq!(
            resolve_terminal_cwd(Some("/nonexistent-livemd-dir"), &home),
            home
        );
        assert_eq!(
            resolve_terminal_cwd(home.to_str(), Path::new("/unused")),
            home
        );
    }
    #[test]
    fn shell_is_not_empty() {
        assert!(!resolve_shell().as_os_str().is_empty());
    }
    #[test]
    fn pty_runs_command_and_preserves_bytes() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new(resolve_shell());
        #[cfg(windows)]
        command.args(["/c", "echo terminal-ready"]);
        #[cfg(not(windows))]
        command.args(["-c", "printf terminal-ready"]);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut answered = false;
            let mut buffer = [0u8; 1024];
            while let Ok(size) = reader.read(&mut buffer) {
                if size == 0 {
                    break;
                }
                output.extend_from_slice(&buffer[..size]);
                // ConPTY 启动时查询光标位置，真实 xterm 会通过 onData 回应。
                if !answered && output.windows(4).any(|bytes| bytes == b"\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    answered = true;
                }
                if String::from_utf8_lossy(&output).contains("terminal-ready") {
                    break;
                }
            }
            let _ = sender.send(output);
        });
        let output = receiver.recv_timeout(std::time::Duration::from_secs(10));
        let _ = child.kill();
        let _ = child.wait();
        drop(pair.master);
        let output = output.expect("PTY 应及时输出命令结果");
        assert!(String::from_utf8_lossy(&output).contains("terminal-ready"));
        assert_eq!(STANDARD.decode(STANDARD.encode(&output)).unwrap(), output);
    }
}

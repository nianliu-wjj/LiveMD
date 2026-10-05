use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportPdfOptions {
    #[serde(default)]
    page_size: Option<Value>,
    #[serde(default)]
    scale: Option<f64>,
}

fn file_path_to_buf(path: FilePath) -> Option<PathBuf> {
    path.into_path().ok()
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension(extension);
    }
    path
}

fn page_dimensions(page_size: &Option<Value>) -> (f64, f64) {
    match page_size {
        Some(Value::String(value)) if value.eq_ignore_ascii_case("Letter") => (8.5, 11.0),
        Some(Value::Object(object)) => {
            let width = object
                .get("width")
                .and_then(Value::as_f64)
                .map(|microns| microns / 25400.0)
                .unwrap_or(8.27);
            let height = object
                .get("height")
                .and_then(Value::as_f64)
                .map(|microns| microns / 25400.0)
                .unwrap_or(11.69);
            (width, height)
        }
        _ => (8.27, 11.69),
    }
}

#[tauri::command]
pub async fn export_pdf<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    element_selector: Option<String>,
    output_name: String,
    options: Option<ExportPdfOptions>,
) -> Result<(), String> {
    let _ = element_selector;
    let options = options.unwrap_or_default();
    let (width, height) = page_dimensions(&options.page_size);
    let scale = options.scale.unwrap_or(1.0).clamp(0.1, 5.0);

    let file_name = if output_name.is_empty() {
        "导出的文档.pdf".to_string()
    } else {
        output_name
    };

    let selected = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导出为 PDF")
        .set_file_name(&file_name)
        .add_filter("PDF 文档", &["pdf"])
        .blocking_save_file()
        .and_then(file_path_to_buf);

    let Some(path) = selected.map(|path| ensure_extension(path, "pdf")) else {
        return Err("用户取消了导出".to_string());
    };

    #[cfg(windows)]
    {
        print_pdf_windows(&window, &path, width, height, scale).await?;
    }

    #[cfg(target_os = "macos")]
    {
        print_pdf_macos(&window, &path, width, height, scale).await?;
    }

    #[cfg(target_os = "linux")]
    {
        print_pdf_linux(&window, &path, width, height, scale).await?;
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (width, height, scale);
        return Err("当前平台暂不支持直接导出 PDF".to_string());
    }

    if !path.exists() {
        return Err("PDF 文件生成失败".to_string());
    }
    Ok(())
}

#[cfg(windows)]
async fn print_pdf_windows<R: Runtime>(
    window: &WebviewWindow<R>,
    path: &Path,
    width: f64,
    height: f64,
    scale: f64,
) -> Result<(), String> {
    use tauri::webview::PlatformWebview;
    use tokio::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING, PCWSTR};

    let (tx, mut rx) = mpsc::unbounded_channel::<Result<(), String>>();
    let dispatch_tx = tx.clone();
    let path_string = path.to_string_lossy().to_string();

    window
        .with_webview(move |platform: PlatformWebview| {
            let fail_tx = dispatch_tx.clone();
            let result = (|| -> Result<(), String> {
                unsafe {
                    let controller = platform.controller();
                    let core = controller
                        .CoreWebView2()
                        .map_err(|error| format!("获取 WebView2 失败: {error}"))?;
                    let webview: ICoreWebView2_7 = core
                        .cast()
                        .map_err(|error| format!("WebView2 版本不支持 PDF 导出: {error}"))?;
                    let environment: ICoreWebView2Environment6 = platform
                        .environment()
                        .cast()
                        .map_err(|error| format!("获取 WebView2 环境失败: {error}"))?;

                    let settings = environment
                        .CreatePrintSettings()
                        .map_err(|error| format!("创建打印设置失败: {error}"))?;
                    settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetPageWidth(width)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetPageHeight(height)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetScaleFactor(scale)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetMarginTop(0.4)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetMarginBottom(0.4)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetMarginLeft(0.4)
                        .map_err(|error| error.to_string())?;
                    settings
                        .SetMarginRight(0.4)
                        .map_err(|error| error.to_string())?;

                    let wide_path = HSTRING::from(path_string.as_str());
                    let callback_tx = dispatch_tx.clone();
                    let handler =
                        PrintToPdfCompletedHandler::create(Box::new(move |error_code, success| {
                            let result = match error_code {
                                Ok(()) if success => Ok(()),
                                Ok(()) => Err("WebView2 未能完成 PDF 导出".to_string()),
                                Err(error) => Err(format!("PDF 导出失败: {error}")),
                            };
                            let _ = callback_tx.send(result);
                            Ok(())
                        }));

                    webview
                        .PrintToPdf(PCWSTR(wide_path.as_ptr()), &settings, &handler)
                        .map_err(|error| format!("启动 PDF 导出失败: {error}"))?;
                }
                Ok(())
            })();

            if let Err(error) = result {
                let _ = fail_tx.send(Err(error));
            }
        })
        .map_err(|error| error.to_string())?;

    drop(tx);

    match tokio::time::timeout(Duration::from_secs(120), rx.recv()).await {
        Ok(Some(result)) => result,
        Ok(None) => Err("PDF 导出未返回结果".to_string()),
        Err(_) => Err("PDF 导出超时".to_string()),
    }
}

#[cfg(target_os = "macos")]
async fn print_pdf_macos<R: Runtime>(
    window: &WebviewWindow<R>,
    path: &Path,
    width: f64,
    height: f64,
    scale: f64,
) -> Result<(), String> {
    use tauri::webview::PlatformWebview;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<Result<(), String>>();
    let path_string = path.to_string_lossy().to_string();

    window
        .with_webview(move |platform: PlatformWebview| {
            let result = unsafe {
                print_pdf_macos_sync(platform.inner().cast(), &path_string, width, height, scale)
            };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    match tokio::time::timeout(Duration::from_secs(120), rx.recv()).await {
        Ok(Some(result)) => result,
        Ok(None) => Err("PDF 导出未返回结果".to_string()),
        Err(_) => Err("PDF 导出超时".to_string()),
    }
}

#[cfg(target_os = "macos")]
unsafe fn print_pdf_macos_sync(
    webview: *mut std::ffi::c_void,
    path: &str,
    width: f64,
    height: f64,
    scale: f64,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_app_kit::{
        NSPaperOrientation, NSPrintInfo, NSPrintSaveJob, NSPrintSavePath, NSPrintingPaginationMode,
    };
    use objc2_foundation::{NSSize, NSString};
    use objc2_web_kit::WKWebView;

    let webview = webview
        .cast::<WKWebView>()
        .as_ref()
        .ok_or("获取 WKWebView 失败")?;
    let landscape = width > height;
    let (paper_width, paper_height) = if landscape {
        (height, width)
    } else {
        (width, height)
    };

    let print_info = NSPrintInfo::new();
    print_info.setPaperSize(NSSize::new(paper_width * 72.0, paper_height * 72.0));
    print_info.setOrientation(if landscape {
        NSPaperOrientation::Landscape
    } else {
        NSPaperOrientation::Portrait
    });
    print_info.setTopMargin(28.8);
    print_info.setBottomMargin(28.8);
    print_info.setLeftMargin(28.8);
    print_info.setRightMargin(28.8);
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    print_info.setScalingFactor(scale);
    print_info.setJobDisposition(NSPrintSaveJob);

    let dictionary = print_info.dictionary();
    let ns_path = NSString::from_str(path);
    let _: () = msg_send![&*dictionary, setObject: &*ns_path, forKey: NSPrintSavePath];

    let operation = webview.printOperationWithPrintInfo(&print_info);
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    if operation.runOperation() {
        Ok(())
    } else {
        Err("系统未能完成 PDF 导出".to_string())
    }
}

#[cfg(target_os = "linux")]
async fn print_pdf_linux<R: Runtime>(
    window: &WebviewWindow<R>,
    path: &Path,
    width: f64,
    height: f64,
    scale: f64,
) -> Result<(), String> {
    use tauri::webview::PlatformWebview;
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<Result<(), String>>();
    let path = path.to_path_buf();

    window
        .with_webview(move |platform: PlatformWebview| {
            let startup_tx = tx.clone();
            if let Err(error) =
                print_pdf_linux_sync(platform.inner(), &path, width, height, scale, tx)
            {
                let _ = startup_tx.send(Err(error));
            }
        })
        .map_err(|error| error.to_string())?;

    match tokio::time::timeout(Duration::from_secs(120), rx.recv()).await {
        Ok(Some(result)) => result,
        Ok(None) => Err("PDF 导出未返回结果".to_string()),
        Err(_) => Err("PDF 导出超时".to_string()),
    }
}

#[cfg(target_os = "linux")]
fn print_pdf_linux_sync(
    webview: webkit2gtk::WebView,
    path: &Path,
    width: f64,
    height: f64,
    scale: f64,
    tx: tokio::sync::mpsc::UnboundedSender<Result<(), String>>,
) -> Result<(), String> {
    use gtk::{PageOrientation, PageSetup, PaperSize, PrintSettings, Unit};
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let landscape = width > height;
    let (paper_width, paper_height) = if landscape {
        (height, width)
    } else {
        (width, height)
    };
    let orientation = if landscape {
        PageOrientation::Landscape
    } else {
        PageOrientation::Portrait
    };

    let paper_size = PaperSize::new_custom(
        "livemd-export",
        "LiveMD Export",
        paper_width,
        paper_height,
        Unit::Inch,
    );
    let page_setup = PageSetup::new();
    page_setup.set_paper_size(&paper_size);
    page_setup.set_orientation(orientation);
    page_setup.set_top_margin(0.4, Unit::Inch);
    page_setup.set_bottom_margin(0.4, Unit::Inch);
    page_setup.set_left_margin(0.4, Unit::Inch);
    page_setup.set_right_margin(0.4, Unit::Inch);

    let settings = PrintSettings::new();
    settings.set_paper_size(&paper_size);
    settings.set_orientation(orientation);
    settings.set_scale(scale * 100.0);
    settings.set_use_color(true);
    settings.set_n_copies(1);
    settings.set_printer("Print to File");
    let uri = url::Url::from_file_path(path).map_err(|_| "无法生成 PDF 文件路径".to_string())?;
    settings.set("output-uri", Some(uri.as_str()));
    settings.set("output-file-format", Some("pdf"));

    let operation = PrintOperation::new(&webview);
    operation.set_page_setup(&page_setup);
    operation.set_print_settings(&settings);

    let finished_tx = tx.clone();
    operation.connect_finished(move |_| {
        let _ = finished_tx.send(Ok(()));
    });
    let failed_tx = tx;
    operation.connect_failed(move |_, error| {
        let _ = failed_tx.send(Err(format!("PDF 导出失败: {error}")));
    });

    operation.print();
    Ok(())
}

#[tauri::command]
pub async fn save_binary_file<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    bytes: Vec<u8>,
    default_name: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let extensions = extensions.unwrap_or_else(|| vec!["docx".to_string()]);
    let extension = extensions
        .first()
        .cloned()
        .unwrap_or_else(|| "bin".to_string());

    let selected = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("导出文件")
        .set_file_name(&default_name)
        .add_filter(
            filter_name.unwrap_or_else(|| "文件".to_string()),
            &extensions.iter().map(String::as_str).collect::<Vec<_>>(),
        )
        .blocking_save_file()
        .and_then(file_path_to_buf);

    let Some(path) = selected.map(|path| ensure_extension(path, &extension)) else {
        return Ok(None);
    };

    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

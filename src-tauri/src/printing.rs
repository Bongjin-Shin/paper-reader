/// Print the exact PDF shown in the preview, without rasterizing its text or changing its layout.
/// GTK owns printer selection, page ranges, copies, cancellation and spool errors.
#[tauri::command]
pub async fn print_vocabulary_pdf(
    window: tauri::WebviewWindow,
    bytes: Vec<u8>,
    mode: String,
    page_number: i32,
) -> Result<bool, String> {
    if !matches!(mode.as_str(), "simple" | "detailed")
        || !bytes.starts_with(b"%PDF-")
        || bytes.len() > 64 * 1024 * 1024
        || page_number < 1
    {
        return Err("인쇄할 PDF 데이터가 올바르지 않습니다.".into());
    }
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let app = window.app_handle().clone();
        app.run_on_main_thread(move || {
            let result = print_linux(&window, bytes, &mode, page_number);
            let _ = sender.send(result);
        })
        .map_err(|_| "인쇄 대화상자를 열지 못했습니다.".to_string())?;
        tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|_| "인쇄 작업을 완료하지 못했습니다.".to_string())?
            .map_err(|_| "인쇄 대화상자가 종료되었습니다.".to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        Err("이 운영체제에서는 PDF로 저장한 뒤 시스템 인쇄를 사용해 주세요.".into())
    }
}

#[cfg(target_os = "linux")]
fn print_linux(
    window: &tauri::WebviewWindow,
    bytes: Vec<u8>,
    mode: &str,
    page_number: i32,
) -> Result<bool, String> {
    use gtk::prelude::*;
    let document = poppler::Document::from_bytes(&gtk::glib::Bytes::from_owned(bytes), None)
        .map_err(|_| "인쇄할 PDF를 읽지 못했습니다.".to_string())?;
    if document.n_pages() < 1 || page_number > document.n_pages() {
        return Err("인쇄할 페이지를 확인해 주세요.".into());
    }
    let parent = window
        .gtk_window()
        .map_err(|_| "앱 창을 찾지 못했습니다.".to_string())?;
    let setup = gtk::PageSetup::new();
    setup.set_paper_size(&gtk::PaperSize::new(Some("iso_a4")));
    setup.set_orientation(gtk::PageOrientation::Portrait);
    // The generated PDF already contains its own A4 margins and page numbers.
    setup.set_top_margin(0., gtk::Unit::Points);
    setup.set_bottom_margin(0., gtk::Unit::Points);
    setup.set_left_margin(0., gtk::Unit::Points);
    setup.set_right_margin(0., gtk::Unit::Points);
    let operation = gtk::PrintOperation::new();
    operation.set_job_name(&format!(
        "Vocabulary - {}",
        if mode == "simple" {
            "Simple"
        } else {
            "Detailed"
        }
    ));
    operation.set_default_page_setup(Some(&setup));
    operation.set_unit(gtk::Unit::Points);
    operation.set_use_full_page(true);
    operation.set_n_pages(document.n_pages());
    operation.set_current_page(page_number - 1);
    operation.set_allow_async(false);
    let draw_error = std::rc::Rc::new(std::cell::Cell::new(false));
    let failed = draw_error.clone();
    operation.connect_draw_page(move |operation, context, index| {
        let Some(page) = document.page(index) else {
            failed.set(true);
            operation.cancel();
            return;
        };
        let (width, height) = page.size();
        let scale = (context.width() / width).min(context.height() / height);
        let Some(cairo) = context.cairo_context() else {
            failed.set(true);
            operation.cancel();
            return;
        };
        cairo.translate(
            (context.width() - width * scale) / 2.,
            (context.height() - height * scale) / 2.,
        );
        cairo.scale(scale, scale);
        page.render_for_printing(&cairo);
        if cairo.status().is_err() {
            failed.set(true);
            operation.cancel();
        }
    });
    let result = operation
        .run(gtk::PrintOperationAction::PrintDialog, Some(&parent))
        .map_err(|_| {
            "프린터에 인쇄 작업을 전달하지 못했습니다. 프린터 설정을 확인해 주세요.".to_string()
        })?;
    if draw_error.get() {
        return Err("인쇄 페이지를 처리하지 못했습니다.".into());
    }
    Ok(result == gtk::PrintOperationResult::Apply)
}

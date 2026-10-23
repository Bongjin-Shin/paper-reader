use lopdf::{dictionary, Document, Object, Stream};
use paper_vocabulary_lib::{
    db::Database,
    library::{cleanup_deleted_pdfs, PaperMetadata},
    papers,
};
use rusqlite::{params, Connection};
use std::{fs, path::Path};

fn pdf(path: &Path, body: &str, variant: bool, image: u8) {
    let mut doc = Document::with_version("1.7");
    if variant {
        doc.add_object(Object::string_literal("unreferenced object"));
    }
    let pages = doc.new_object_id();
    let font = doc.add_object(
        dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" },
    );
    let image = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
        },
        vec![image],
    ));
    let content = doc.add_object(Stream::new(
        dictionary! {},
        format!("BT /F1 12 Tf 20 700 Td ({body}) Tj ET\nq 20 0 0 20 20 600 cm /Im1 Do Q\n")
            .into_bytes(),
    ));
    let mut page = dictionary! { "Type" => "Page", "Parent" => pages, "Contents" => content };
    if variant {
        page.set("Annots", vec![Object::Dictionary(dictionary! {
            "Type" => "Annot", "Subtype" => "Text", "Rect" => vec![10.into(), 10.into(), 20.into(), 20.into()],
            "Contents" => Object::string_literal("Personal note"),
        })]);
        page.set("LastModified", Object::string_literal("D:20261019000000"));
    }
    let page = doc.add_object(page);
    doc.objects.insert(pages, Object::Dictionary(dictionary! {
        "Type" => "Pages", "Kids" => vec![Object::Reference(page)], "Count" => 1,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font }, "XObject" => dictionary! { "Im1" => image } },
    }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    let info = doc.add_object(dictionary! {
        "Title" => Object::string_literal("Same title for every fixture"),
        "CreationDate" => Object::string_literal(if variant { "D:20261019000000" } else { "D:20261008000000" }),
    });
    doc.trailer.set("Root", catalog);
    doc.trailer.set("Info", info);
    doc.trailer.set(
        "ID",
        vec![Object::string_literal(if variant {
            "new-id"
        } else {
            "old-id"
        })],
    );
    if variant {
        doc.compress();
    }
    doc.save(path).unwrap();
}

fn add_tracking_stroke(path: &Path, alpha: i64) {
    let mut doc = Document::load(path).unwrap();
    let page_id = doc.get_pages()[&1];
    let parent = doc
        .get_dictionary(page_id)
        .unwrap()
        .get(b"Parent")
        .unwrap()
        .as_reference()
        .unwrap();
    let mut resources = doc
        .get_dictionary(parent)
        .unwrap()
        .get(b"Resources")
        .unwrap()
        .as_dict()
        .unwrap()
        .clone();
    resources.set("ExtGState", dictionary! { "DownloadSpecificName" => dictionary! { "Type" => "ExtGState", "CA" => alpha } });
    doc.get_dictionary_mut(page_id)
        .unwrap()
        .set("Resources", resources);
    doc.add_page_contents(
        page_id,
        b"q /DownloadSpecificName gs 1 1 1 RG 0.5 w [] 0 d 84 0 m 85 0 l S Q\n".to_vec(),
    )
    .unwrap();
    doc.save(path).unwrap();
}

#[test]
fn invisible_download_tracking_is_ignored_but_visible_drawing_changes_are_not() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let source = dir.path().join("first.pdf");
    let tracked = dir.path().join("downloaded-again.pdf");
    let revised = dir.path().join("revised-figure.pdf");
    for path in [&source, &tracked, &revised] {
        pdf(path, "Original body", false, 0);
    }
    add_tracking_stroke(&tracked, 0);
    add_tracking_stroke(&revised, 1);
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    let first = papers::import_library_pdf(&source, &copies, &db, None).unwrap();
    db.set_paper_importance(&first.id, 5).unwrap();
    assert_eq!(
        papers::import_library_pdf(&tracked, &copies, &db, None)
            .unwrap()
            .id,
        first.id
    );
    assert_ne!(
        papers::import_library_pdf(&revised, &copies, &db, None)
            .unwrap()
            .id,
        first.id
    );
    assert_eq!(db.library().unwrap().papers.len(), 2);
}

#[test]
fn imports_use_current_time_but_reader_opening_does_not_change_upload_time() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let source = dir.path().join("paper.pdf");
    pdf(&source, "Original body", false, 0);
    let path = dir.path().join("data.db");
    let mut db = Database::open(&path).unwrap();
    let sql = Connection::open(&path).unwrap();
    let before: String = sql
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
            r.get(0)
        })
        .unwrap();
    let paper = papers::import_library_pdf(&source, &copies, &db, None).unwrap();
    assert!(db.library().unwrap().papers[0].uploaded_at >= before);
    // A prior import (October 8) must not become the date of today's explicit upload.
    let old = "2020-10-08T08:00:00.000Z";
    sql.execute(
        "UPDATE papers SET added_at=?1 WHERE id=?2",
        params![old, paper.id],
    )
    .unwrap();
    papers::import_pdf(&source, &copies, &db).unwrap();
    assert_eq!(db.library().unwrap().papers[0].uploaded_at, old);
    papers::import_library_pdf(&source, &copies, &db, None).unwrap();
    assert!(db.library().unwrap().papers[0].uploaded_at >= before);
    assert_eq!(db.library().unwrap().papers.len(), 1);

    sql.execute(
        "UPDATE papers SET added_at=?1 WHERE id=?2",
        params![old, paper.id],
    )
    .unwrap();
    db.delete_library_paper(&paper.id).unwrap();
    cleanup_deleted_pdfs(&db, &copies).unwrap();
    // A Reader import also uploads a new Library membership after deletion.
    let restored = papers::import_pdf(&source, &copies, &db).unwrap();
    assert_eq!(restored.id, paper.id);
    assert!(db.library().unwrap().papers[0].uploaded_at >= before);
}

#[test]
fn content_identity_ignores_personal_settings_file_names_metadata_and_annotations() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let source = dir.path().join("first.pdf");
    let variant = dir.path().join("renamed.pdf");
    pdf(&source, "Original body", false, 0);
    pdf(&variant, "Original body", true, 0);
    assert_ne!(fs::read(&source).unwrap(), fs::read(&variant).unwrap());
    let path = dir.path().join("data.db");
    let db = Database::open(&path).unwrap();
    let original = papers::import_library_pdf(&source, &copies, &db, None).unwrap();
    db.update_paper_metadata(
        &original.id,
        &PaperMetadata {
            title: "My corrected title".into(),
            authors: "Chosen authors".into(),
            published_date: "2024".into(),
        },
        false,
    )
    .unwrap();
    db.set_paper_importance(&original.id, 5).unwrap();
    db.set_paper_memo(&original.id, "Keep my notes").unwrap();
    let folder = db.create_library_folder(None, "Research").unwrap();
    // Simulate an existing installation with no content index and a fresh app session.
    Connection::open(&path)
        .unwrap()
        .execute("DELETE FROM paper_fingerprints", [])
        .unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let imported = papers::import_pdfs(
        &[variant.clone(), source.clone(), variant.clone()],
        &copies,
        &db,
        Some(Some(folder.id)),
    )
    .unwrap();
    assert!(imported.failures.is_empty());
    assert_eq!(imported.papers.len(), 1);
    assert_eq!(imported.papers[0].id, original.id);
    let library = db.library().unwrap();
    assert_eq!(library.papers.len(), 1);
    let stored = &library.papers[0];
    assert_eq!(stored.paper.title, "My corrected title");
    assert_eq!(stored.authors, "Chosen authors");
    assert_eq!(stored.published_date, "2024");
    assert_eq!(stored.importance, 5);
    assert_eq!(stored.memo, "Keep my notes");
    assert_eq!(stored.folder_id, Some(folder.id));
    assert_eq!(
        fs::read(db.paper_path(&original.id).unwrap()).unwrap(),
        fs::read(&source).unwrap()
    );
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 1);
    let reader = papers::import_pdf(&variant, &copies, &db).unwrap();
    assert_eq!(reader.id, original.id);
    assert_eq!(reader.file_name, "renamed.pdf");
    assert_eq!(db.library().unwrap().papers[0].folder_id, Some(folder.id));
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(
        papers::import_library_pdf(&variant, &copies, &db, None)
            .unwrap()
            .id,
        original.id
    );
    db.delete_library_paper(&original.id).unwrap();
    cleanup_deleted_pdfs(&db, &copies).unwrap();
    assert_eq!(fs::read_dir(&copies).unwrap().count(), 0);
    assert_eq!(
        papers::import_library_pdf(&variant, &copies, &db, None)
            .unwrap()
            .id,
        original.id
    );
    assert_eq!(db.library().unwrap().papers[0].importance, 5);
    assert_eq!(db.library().unwrap().papers[0].memo, "Keep my notes");
}

#[test]
fn same_title_does_not_merge_different_text_or_images_and_unparseable_pdfs_use_byte_identity() {
    let dir = tempfile::tempdir().unwrap();
    let copies = dir.path().join("papers");
    fs::create_dir(&copies).unwrap();
    let db = Database::open(&dir.path().join("data.db")).unwrap();
    let source = dir.path().join("same-name.pdf");
    let mut ids = std::collections::HashSet::new();
    for (body, image) in [("First body", 0), ("Revised body", 0), ("First body", 255)] {
        pdf(&source, body, false, image);
        assert!(ids.insert(
            papers::import_library_pdf(&source, &copies, &db, None)
                .unwrap()
                .id
        ));
    }
    for body in [
        b"%PDF-1.7\ninvalid one".as_slice(),
        b"%PDF-1.7\ninvalid two",
    ] {
        fs::write(&source, body).unwrap();
        let first = papers::import_library_pdf(&source, &copies, &db, None).unwrap();
        assert!(ids.insert(first.id.clone()));
        assert_eq!(
            papers::import_library_pdf(&source, &copies, &db, None)
                .unwrap()
                .id,
            first.id
        );
    }
    assert_eq!(db.library().unwrap().papers.len(), 5);
}

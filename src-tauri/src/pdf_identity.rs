//! Conservative identity of the complete page objects and their rendering resources.
//! Trailer IDs, document metadata, annotations and object numbering are not identity.
//! Unknown/cyclic structures fall back to the existing byte hash, never a partial hash.
use lopdf::{
    content::{Content, Operation},
    Dictionary, Document, LoadOptions, Object, ObjectId, Stream,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

const LIMIT: usize = 256 * 1024 * 1024;

pub(crate) fn fingerprint(bytes: &[u8]) -> Option<String> {
    let document = Document::load_mem_with_options(
        bytes,
        LoadOptions {
            max_decompressed_size: Some(LIMIT),
            ..Default::default()
        },
    )
    .ok()?;
    if document.is_encrypted() {
        return None;
    }
    let pages = document.get_pages();
    if pages.is_empty() {
        return None;
    }
    let mut identity = Identity {
        document: &document,
        cached: HashMap::new(),
        visiting: HashSet::new(),
        remaining: LIMIT,
    };
    let mut digest = Sha256::new();
    digest.update(b"paper-pages-v1");
    for page_id in pages.values() {
        let mut page = document.get_dictionary(*page_id).ok()?.clone();
        // Resolve the four inheritable page attributes before removing the page tree.
        for key in [b"Resources".as_slice(), b"MediaBox", b"CropBox", b"Rotate"] {
            let mut ancestor = document.get_dictionary(*page_id).ok()?;
            let mut visited = HashSet::new();
            loop {
                if let Ok(value) = ancestor.get(key) {
                    page.set(key, value.clone());
                    break;
                }
                let Ok(parent) = ancestor.get(b"Parent") else {
                    break;
                };
                let id = parent.as_reference().ok()?;
                if !visited.insert(id) {
                    return None;
                }
                ancestor = document.get_dictionary(id).ok()?;
            }
        }
        for key in [
            b"Parent".as_slice(),
            b"Annots",
            b"Metadata",
            b"LastModified",
            b"PieceInfo",
            b"StructParents",
            b"B",
        ] {
            page.remove(key);
        }
        normalize_page_content(&document, *page_id, &mut page)?;
        digest.update(identity.object(&Object::Dictionary(page), 0)?);
    }
    Some(format!("pages-v1:{:x}", digest.finalize()))
}

fn resolved_dictionary<'a>(document: &'a Document, object: &'a Object) -> Option<&'a Dictionary> {
    document.dereference(object).ok()?.1.as_dict().ok()
}

/// Some download providers embed a different invisible tracking pattern in each copy.
/// Remove only isolated, fully transparent strokes; visible diagrams, text, images,
/// clipping and all other drawing commands remain part of the identity.
fn normalize_page_content(
    document: &Document,
    page_id: ObjectId,
    page: &mut Dictionary,
) -> Option<()> {
    if !page.has(b"Contents") {
        return Some(());
    }
    // The convenience reader skips dangling/non-stream contents. Reject those here
    // so an incomplete parse can never identify unrelated pages as the same page.
    let contents = document.dereference(page.get(b"Contents").ok()?).ok()?.1;
    match contents {
        Object::Stream(_) => {}
        Object::Array(items) => {
            for item in items {
                document.dereference(item).ok()?.1.as_stream().ok()?;
            }
        }
        _ => return None,
    }
    let bytes = document.get_page_content_with_limit(page_id, LIMIT).ok()?;
    let Ok(mut content) = Content::decode(&bytes) else {
        return Some(());
    };
    let mut resources = page
        .get(b"Resources")
        .ok()
        .and_then(|value| resolved_dictionary(document, value))
        .cloned();
    let mut states = resources
        .as_ref()
        .and_then(|r| r.get(b"ExtGState").ok())
        .and_then(|value| resolved_dictionary(document, value))
        .cloned();
    let mut removed = HashSet::new();
    let mut kept = Vec::new();
    let mut offset = 0;
    let mut open_path = false;
    while offset < content.operations.len() {
        let tail = &content.operations[offset..];
        if !open_path && tail[0].operator == "q" {
            if let Some(end) = tail.iter().position(|op| op.operator == "Q") {
                if let Some(name) = transparent_stroke(document, &tail[..=end], states.as_ref()) {
                    removed.insert(name.to_vec());
                    offset += end + 1;
                    continue;
                }
            }
        }
        let operation = &tail[0];
        match operation.operator.as_str() {
            "m" | "l" | "c" | "v" | "y" | "h" | "re" => open_path = true,
            "n" | "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" => open_path = false,
            _ => {}
        }
        kept.push(operation.clone());
        offset += 1;
    }
    if let Some(ref mut states) = states {
        for name in removed {
            if !kept.iter().any(|op| {
                op.operator == "gs"
                    && op.operands.first().and_then(|o| o.as_name().ok()) == Some(name.as_slice())
            }) {
                states.remove(&name);
            }
        }
        if let Some(ref mut resources) = resources {
            if states.is_empty() {
                resources.remove(b"ExtGState");
            } else {
                resources.set("ExtGState", states.clone());
            }
        }
    }
    if let Some(resources) = resources {
        page.set("Resources", resources);
    }
    content.operations = kept;
    page.set(
        "Contents",
        Stream::new(Dictionary::new(), content.encode().ok()?),
    );
    Some(())
}

fn transparent_stroke<'a>(
    document: &Document,
    operations: &'a [Operation],
    states: Option<&Dictionary>,
) -> Option<&'a [u8]> {
    if operations.len() < 5
        || operations[1].operator != "gs"
        || !matches!(
            operations[operations.len() - 2].operator.as_str(),
            "S" | "s"
        )
    {
        return None;
    }
    let name = operations[1].operands.first()?.as_name().ok()?;
    let state = resolved_dictionary(document, states?.get(name).ok()?)?;
    if state
        .iter()
        .any(|(key, _)| !matches!(key.as_slice(), b"Type" | b"CA"))
    {
        return None;
    }
    let alpha = state.get(b"CA").ok()?;
    if !matches!(alpha, Object::Integer(0))
        && !matches!(alpha, Object::Real(value) if *value == 0.0)
    {
        return None;
    }
    if !operations[2..operations.len() - 2].iter().all(|op| {
        matches!(
            op.operator.as_str(),
            "RG" | "G"
                | "K"
                | "w"
                | "d"
                | "J"
                | "j"
                | "M"
                | "m"
                | "l"
                | "c"
                | "v"
                | "y"
                | "h"
                | "re"
        )
    }) {
        return None;
    }
    Some(name)
}

struct Identity<'a> {
    document: &'a Document,
    cached: HashMap<ObjectId, [u8; 32]>,
    visiting: HashSet<ObjectId>,
    remaining: usize,
}

fn field(digest: &mut Sha256, bytes: &[u8]) {
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
}

impl Identity<'_> {
    fn dictionary(
        &mut self,
        digest: &mut Sha256,
        dictionary: &Dictionary,
        depth: usize,
    ) -> Option<()> {
        // Dictionary insertion order and indirect object numbers are serialization details.
        for (key, value) in dictionary.iter().collect::<BTreeMap<_, _>>() {
            if key == b"Metadata" {
                continue;
            }
            field(digest, key);
            digest.update(self.object(value, depth + 1)?);
        }
        Some(())
    }

    fn object(&mut self, value: &Object, depth: usize) -> Option<[u8; 32]> {
        if depth > 100 {
            return None;
        }
        self.remaining = self.remaining.checked_sub(1)?;
        let mut digest = Sha256::new();
        match value {
            Object::Reference(id) => {
                if let Some(hash) = self.cached.get(id) {
                    return Some(*hash);
                }
                if !self.visiting.insert(*id) {
                    return None;
                }
                let hash = self.object(self.document.get_object(*id).ok()?, depth + 1)?;
                self.visiting.remove(id);
                self.cached.insert(*id, hash);
                return Some(hash);
            }
            Object::Null => digest.update(b"null"),
            Object::Boolean(value) => {
                digest.update(if *value { b"true".as_slice() } else { b"false" })
            }
            Object::Integer(value) => {
                digest.update(b"number");
                field(&mut digest, value.to_string().as_bytes());
            }
            Object::Real(value) => {
                digest.update(b"number");
                field(&mut digest, value.to_string().as_bytes());
            }
            Object::Name(value) => {
                digest.update(b"name");
                field(&mut digest, value);
            }
            Object::String(value, _) => {
                digest.update(b"string");
                field(&mut digest, value);
            }
            Object::Array(values) => {
                digest.update(b"array");
                for value in values {
                    digest.update(self.object(value, depth + 1)?);
                }
            }
            Object::Dictionary(value) => {
                digest.update(b"dictionary");
                self.dictionary(&mut digest, value, depth)?;
            }
            Object::Stream(stream) => {
                digest.update(b"stream");
                let mut dictionary = stream.dict.clone();
                dictionary.remove(b"Length");
                // Unsupported image codecs retain both the encoded bytes and filter settings.
                let decoded = stream.decompressed_content_with_limit(self.remaining).ok();
                let content = if let Some(ref content) = decoded {
                    dictionary.remove(b"Filter");
                    dictionary.remove(b"DecodeParms");
                    content.as_slice()
                } else {
                    stream.content.as_slice()
                };
                self.remaining = self.remaining.checked_sub(content.len())?;
                self.dictionary(&mut digest, &dictionary, depth)?;
                field(&mut digest, content);
            }
        }
        Some(digest.finalize().into())
    }
}

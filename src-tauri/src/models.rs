use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub file_name: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PositionData {
    pub version: u8,
    /// PDF user-space rectangles, independent of screen pixels, scale and rotation.
    pub rects: Vec<[f64; 4]>,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionType {
    Translation,
    Explanation,
}

impl ActionType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Translation => "translation",
            Self::Explanation => "explanation",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupRequest {
    pub paper_id: String,
    pub page_number: u32,
    pub word: String,
    pub original_sentence: String,
    pub action: ActionType,
    pub position: PositionData,
    #[serde(default)]
    pub color: HighlightColor,
}

impl LookupRequest {
    pub fn validate(&self) -> Result<(), String> {
        if !is_single_word(&self.word) {
            return Err("영어 단어 하나를 선택해 주세요.".into());
        }
        if self.page_number == 0
            || self.original_sentence.trim().is_empty()
            || self.original_sentence.chars().count() > 1600
        {
            return Err("선택한 단어의 문맥 또는 페이지 정보가 올바르지 않습니다.".into());
        }
        if self.position.version != 1
            || self.position.rects.is_empty()
            || self.position.rects.len() > 32
            || self.position.end_offset <= self.position.start_offset
            || self.position.rects.iter().any(|r| {
                r.iter().any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
                    || r[2] <= r[0]
                    || r[3] <= r[1]
            })
        {
            return Err("선택 위치를 확인할 수 없습니다. 단어를 다시 선택해 주세요.".into());
        }
        Ok(())
    }
}

pub fn is_single_word(text: &str) -> bool {
    let mut previous_letter = false;
    if text.is_empty() || text.len() > 100 {
        return false;
    }
    for character in text.chars() {
        if character.is_ascii_alphabetic() {
            previous_letter = true;
        } else if matches!(character, '-' | '\'' | '’') && previous_letter {
            previous_letter = false;
        } else {
            return false;
        }
    }
    previous_letter
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLookupRequest {
    pub paper_id: String,
    pub page_number: u32,
    pub selected_text: String,
    pub context: String,
    pub action: ActionType,
}

impl TextLookupRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.page_number == 0
            || self.selected_text.trim().is_empty()
            || self.context.trim().is_empty()
        {
            return Err("선택한 텍스트와 문맥을 확인해 주세요.".into());
        }
        if self.selected_text.chars().count() > 12_000 || self.context.chars().count() > 13_600 {
            return Err("한 번에 12,000자 이하의 텍스트를 선택해 주세요.".into());
        }
        if is_single_word(self.selected_text.trim()) {
            return Err("단일 영어 단어는 단어 조회를 사용해 주세요.".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: i64,
    pub paper_id: String,
    pub vocabulary_entry_id: i64,
    pub page_number: u32,
    pub selected_text: String,
    pub position: PositionData,
    pub color: HighlightColor,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HighlightColor {
    #[default]
    Yellow,
    Green,
    Blue,
    Pink,
    Purple,
}

impl HighlightColor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yellow => "yellow",
            Self::Green => "green",
            Self::Blue => "blue",
            Self::Pink => "pink",
            Self::Purple => "purple",
        }
    }
    pub fn from_name(name: &str) -> Self {
        match name {
            "green" => Self::Green,
            "blue" => Self::Blue,
            "pink" => Self::Pink,
            "purple" => Self::Purple,
            _ => Self::Yellow,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResult {
    pub text: String,
    pub highlight: Option<Highlight>,
}

pub fn normalized_word(word: &str) -> String {
    word.replace('’', "'").to_ascii_lowercase()
}

pub fn lookup_key(text: &str) -> String {
    if is_single_word(text) {
        normalized_word(text)
    } else {
        text.to_owned()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyContext {
    pub paper_id: String,
    pub paper_title: String,
    pub page_number: u32,
    pub original_sentence: String,
    pub translation: Option<String>,
    pub explanation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyEntry {
    pub id: i64,
    pub word: String,
    pub translation: Option<String>,
    pub explanation: Option<String>,
    pub lookup_count: i64,
    pub contexts: Vec<VocabularyContext>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedHighlight {
    pub original_sentence: String,
    pub action: ActionType,
    pub text: String,
    pub translation: Option<String>,
    pub explanation: Option<String>,
}

use crate::db::{db_error, Database};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Api,
    Chatgpt,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreferences {
    pub translation_model: String,
    pub translation_effort: String,
    pub chat_model: String,
    pub chat_effort: String,
}

impl Database {
    pub fn chat_provider(&self) -> Result<AiProvider, String> {
        let name: String = self
            .connection
            .query_row(
                "SELECT chat_provider FROM ai_preferences WHERE id=1",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        Ok(if name == "claude" {
            AiProvider::Claude
        } else {
            AiProvider::Chatgpt
        })
    }
    pub fn set_chat_provider(&self, provider: AiProvider) -> Result<(), String> {
        let name = match provider {
            AiProvider::Claude => "claude",
            AiProvider::Chatgpt => "chatgpt",
            AiProvider::Api => return Err("채팅 연결을 선택해 주세요.".into()),
        };
        self.connection
            .execute(
                "UPDATE ai_preferences SET chat_provider=?1 WHERE id=1",
                [name],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn provider_preferences(&self, provider: AiProvider) -> Result<ModelPreferences, String> {
        if provider != AiProvider::Claude {
            return self.model_preferences();
        }
        self.connection.query_row("SELECT translation_model, translation_effort, chat_model, chat_effort FROM claude_preferences WHERE id=1", [], |r| Ok(ModelPreferences {
            translation_model: r.get(0)?, translation_effort: r.get(1)?, chat_model: r.get(2)?, chat_effort: r.get(3)?
        })).map_err(db_error)
    }
    pub fn set_provider_model_preference(
        &self,
        provider: AiProvider,
        scope: &str,
        model: &str,
        effort: &str,
    ) -> Result<(), String> {
        if provider != AiProvider::Claude {
            return self.set_model_preference(scope, model, effort);
        }
        if model.len() > 150
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))
            || !["", "low", "medium", "high", "xhigh", "max"].contains(&effort)
        {
            return Err("Claude 모델 설정이 올바르지 않습니다.".into());
        }
        let sql = match scope {
            "translation" if !model.is_empty() => "UPDATE claude_preferences SET translation_model=?1, translation_effort=?2 WHERE id=1",
            "chat" => "UPDATE claude_preferences SET chat_model=?1, chat_effort=?2 WHERE id=1",
            _ => return Err("모델 설정 종류가 올바르지 않습니다.".into())
        };
        self.connection
            .execute(sql, [model, effort])
            .map_err(db_error)?;
        Ok(())
    }
    pub fn model_preferences(&self) -> Result<ModelPreferences, String> {
        self.connection.query_row("SELECT translation_model, chat_model, chat_effort, translation_effort FROM ai_preferences WHERE id = 1", [], |r| {
            Ok(ModelPreferences { translation_model: r.get(0)?, chat_model: r.get(1)?, chat_effort: r.get(2)?, translation_effort: r.get(3)? })
        }).map_err(db_error)
    }
    pub fn set_model_preference(
        &self,
        scope: &str,
        model: &str,
        effort: &str,
    ) -> Result<(), String> {
        if model.len() > 150
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-._".contains(c))
            || effort.len() > 20
        {
            return Err("모델 설정이 올바르지 않습니다.".into());
        }
        match scope {
            "translation" if !model.is_empty() => self.connection.execute(
                "UPDATE ai_preferences SET translation_model = ?1, translation_effort = ?2 WHERE id = 1",
                [model, effort],
            ),
            "chat" => self.connection.execute(
                "UPDATE ai_preferences SET chat_model = ?1, chat_effort = ?2 WHERE id = 1",
                [model, effort],
            ),
            _ => return Err("모델 설정 종류가 올바르지 않습니다.".into()),
        }
        .map_err(db_error)?;
        Ok(())
    }
    pub fn ai_provider(&self) -> Result<AiProvider, String> {
        let name: String = self
            .connection
            .query_row(
                "SELECT provider FROM ai_preferences WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        match name.as_str() {
            "api" => Ok(AiProvider::Api),
            "chatgpt" => Ok(AiProvider::Chatgpt),
            "claude" => Ok(AiProvider::Claude),
            _ => Err("번역 연결 설정을 읽지 못했습니다.".into()),
        }
    }
    pub fn set_ai_provider(&self, provider: AiProvider) -> Result<(), String> {
        let name = match provider {
            AiProvider::Api => "api",
            AiProvider::Chatgpt => "chatgpt",
            AiProvider::Claude => "claude",
        };
        self.connection
            .execute(
                "UPDATE ai_preferences SET provider = ?1 WHERE id = 1",
                [name],
            )
            .map_err(db_error)?;
        Ok(())
    }
}

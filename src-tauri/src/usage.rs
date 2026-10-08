use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub model: String,
    pub input_nano_usd_per_token: i64,
    pub cached_input_nano_usd_per_token: i64,
    pub cache_write_nano_usd_per_token: i64,
    pub output_nano_usd_per_token: i64,
}

impl Default for Pricing {
    fn default() -> Self {
        serde_json::from_str(include_str!("../pricing.json")).expect("valid bundled pricing")
    }
}

#[derive(Debug, Clone)]
pub struct TokenUsage {
    pub input: i64,
    pub cached_input: i64,
    pub cache_write: i64,
    pub output: i64,
    pub estimated: bool,
}

impl TokenUsage {
    pub fn from_response(body: &Value, request_body: &Value, text: &str) -> Self {
        let usage = &body["usage"];
        if let (Some(input), Some(output)) = (
            usage["input_tokens"].as_i64(),
            usage["output_tokens"].as_i64(),
        ) {
            let cached_input = usage["input_tokens_details"]["cached_tokens"]
                .as_i64()
                .unwrap_or(0);
            let cache_write = usage["input_tokens_details"]["cache_write_tokens"]
                .as_i64()
                .unwrap_or(0);
            if input >= 0
                && output >= 0
                && cached_input >= 0
                && cache_write >= 0
                && cached_input.saturating_add(cache_write) <= input
            {
                return Self {
                    input,
                    output,
                    cached_input,
                    cache_write,
                    estimated: false,
                };
            }
        }
        // No invented "actual" usage: conservatively use UTF-8 bytes plus message
        // overhead, mark this call as estimated, and disclose the fallback in the UI.
        Self {
            input: (request_body["instructions"].as_str().unwrap_or("").len()
                + request_body["input"].as_str().unwrap_or("").len()
                + 16) as i64,
            output: text.len() as i64,
            cached_input: 0,
            cache_write: 0,
            estimated: true,
        }
    }

    pub fn cost(&self, pricing: &Pricing) -> Result<i64, String> {
        if self.input < 0
            || self.output < 0
            || self.cached_input < 0
            || self.cache_write < 0
            || self.cached_input.saturating_add(self.cache_write) > self.input
        {
            return Err("사용량 정보가 올바르지 않습니다.".into());
        }
        let mut total = 0i64;
        for (tokens, rate) in [
            (
                self.input - self.cached_input - self.cache_write,
                pricing.input_nano_usd_per_token,
            ),
            (self.cached_input, pricing.cached_input_nano_usd_per_token),
            (self.cache_write, pricing.cache_write_nano_usd_per_token),
            (self.output, pricing.output_nano_usd_per_token),
        ] {
            if rate < 0 {
                return Err("API 단가가 올바르지 않습니다.".into());
            }
            total = tokens
                .checked_mul(rate)
                .and_then(|cost| total.checked_add(cost))
                .ok_or_else(|| "사용량 계산 범위를 초과했습니다.".to_string())?;
        }
        Ok(total)
    }
}

#[derive(Debug)]
pub struct AiResult {
    pub provider: crate::connection::AiProvider,
    pub text: String,
    pub response_id: Option<String>,
    pub usage: TokenUsage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub initial_credit_usd: Option<f64>,
    pub total_cost_usd: f64,
    pub estimated_balance_usd: Option<f64>,
    pub estimated_calls: i64,
    pub pricing: Pricing,
}

pub fn parse_credit(usd: &str) -> Result<i64, String> {
    let value = usd.trim();
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next().unwrap_or("");
    if whole.is_empty()
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|c| c.is_ascii_digit())
        || parts.next().is_some()
    {
        return Err(
            "초기 크레딧을 0 이상의 USD 금액으로 입력해 주세요. 소수 둘째 자리까지 가능합니다."
                .into(),
        );
    }
    let dollars: i64 = whole
        .parse()
        .map_err(|_| "금액이 너무 큽니다.".to_string())?;
    let cents: i64 = format!("{fraction:0<2}").parse().unwrap_or(0);
    if dollars > 1_000_000 || (dollars == 1_000_000 && cents > 0) {
        return Err("초기 크레딧은 $1,000,000 이하여야 합니다.".into());
    }
    Ok(dollars * 1_000_000_000 + cents * 10_000_000)
}

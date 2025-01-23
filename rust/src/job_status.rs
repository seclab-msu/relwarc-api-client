use serde::Deserialize;

pub type AnalysisResult = serde_json::Value;

#[derive(Deserialize)]
pub struct JobStatusMsg {
    pub r#type: String,
    pub message: Option<String>,
    pub result: Option<AnalysisResult>,
}

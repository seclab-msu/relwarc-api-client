use std::error::Error;

#[derive(Debug)]
pub struct BadSchemeError {
    pub scheme: String,
}

impl Error for BadSchemeError {}

impl std::fmt::Display for BadSchemeError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "Bad scheme: {}", self.scheme)
    }
}

#[derive(Debug)]
pub struct RelwarcAPIError {
    pub endpoint_url: String,
    pub status: u16,
    pub error_message: String,
}

impl Error for RelwarcAPIError {}

impl std::fmt::Display for RelwarcAPIError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "Relwarc API endpoint {} responded with status {}: {}",
            self.endpoint_url, self.status, self.error_message
        )
    }
}

#[derive(Debug)]
pub struct RelwarcJobError {
    pub job_id: u64,
    pub error_message: String,
}

impl Error for RelwarcJobError {}

impl std::fmt::Display for RelwarcJobError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "Relwarc failed to execute job {}, error msg is: {}",
            self.job_id, self.error_message
        )
    }
}

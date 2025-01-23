use std::error::Error;
use std::io;

pub const DEFAULT_SERVER_ADDR: &str = "https://relwarc.solidpoint.net";

pub mod errors;
pub mod job_status;
mod reader_length;

pub use job_status::{AnalysisResult, JobStatusMsg};

#[derive(Debug)]
pub struct RelwarcAPIClient {
    pub token: String,
    server_addr: url::Url,
    server_origin: String,
    ws_url: url::Url,
    http_client: reqwest::blocking::Client,
}

impl RelwarcAPIClient {
    pub fn new(token: String) -> Result<RelwarcAPIClient, Box<dyn Error>> {
        RelwarcAPIClient::new_for_server(token, DEFAULT_SERVER_ADDR)
    }
    pub fn new_for_server(
        token: String,
        server_addr: &str,
    ) -> Result<RelwarcAPIClient, Box<dyn Error>> {
        let server_addr_parsed = url::Url::parse(&server_addr)?;
        let origin = server_addr_parsed.origin().ascii_serialization();

        let ws_scheme = server_addr_parsed.scheme().replace("http", "ws");
        let mut ws_url = server_addr_parsed.join("/api/job/watch")?;
        let scheme_was_set = ws_url.set_scheme(&ws_scheme);
        if scheme_was_set.is_err() {
            return Err(Box::new(errors::BadSchemeError { scheme: ws_scheme }));
        }
        Ok(RelwarcAPIClient {
            token: token,
            server_addr: server_addr_parsed,
            server_origin: origin,
            ws_url: ws_url,
            http_client: reqwest::blocking::Client::new(),
        })
    }


    pub fn analyze_source_code<T: io::Read + Send + 'static>(
        &self,
        source_code: T,
    ) -> Result<AnalysisResult, Box<dyn Error>> {
        let (source_code, source_code_length) = reader_length::determine_length(source_code)?;
        self.analyze_source_code_sized(source_code, source_code_length)
    }

    pub fn analyze_page_url(&self, page_url: String) -> Result<AnalysisResult, Box<dyn Error>> {
        let job_id = self.send_page_analysis_request(page_url)?;
        self.websocket_wait_for_job_result(job_id)
    }

    pub fn analyze_page_tar<T: io::Read + Send + 'static>(
        &self,
        tar_archive: T,
    ) -> Result<AnalysisResult, Box<dyn Error>> {
        let (tar_archive, tar_archive_length) = reader_length::determine_length(tar_archive)?;
        self.analyze_page_tar_sized(tar_archive, tar_archive_length)
    }

    pub fn analyze_source_code_sized<T: io::Read + Send + 'static>(
        &self,
        source_code: T,
        source_code_size: u64,
    ) -> Result<AnalysisResult, Box<dyn Error>> {
        let job_id = self.send_source_code_analysis_request_sized(source_code, source_code_size)?;
        self.websocket_wait_for_job_result(job_id)
    }

    pub fn analyze_page_tar_sized<T: io::Read + Send + 'static>(
        &self,
        tar_archive: T,
        tar_archive_size: u64,
    ) -> Result<AnalysisResult, Box<dyn Error>> {
        let job_id = self.send_tar_analysis_request_sized(tar_archive, tar_archive_size)?;
        self.websocket_wait_for_job_result(job_id)
    }

    pub fn send_page_analysis_request(&self, page_url: String) -> Result<u64, Box<dyn Error>> {
        let endpoint_url = self.server_addr.join("/api/analyze-url")?;
        let page_url_bytes = page_url.into_bytes();
        let page_url_byte_length = page_url_bytes.len();

        self.send_analysis_request(
            endpoint_url,
            "text/plain",
            io::Cursor::new(page_url_bytes),
            page_url_byte_length as u64,
        )
    }


    pub fn send_source_code_analysis_request<T: io::Read + Send + 'static>(
        &self,
        source_code: T,
    ) -> Result<u64, Box<dyn Error>> {
        let (source_code, source_code_length) = reader_length::determine_length(source_code)?;
        self.send_source_code_analysis_request_sized(source_code, source_code_length)
    }

    pub fn send_tar_analysis_request<T: io::Read + Send + 'static>(
        &self,
        tar_archive: T,
    ) -> Result<u64, Box<dyn Error>> {
        let (tar_archive, tar_archive_length) = reader_length::determine_length(tar_archive)?;
        self.send_tar_analysis_request_sized(tar_archive, tar_archive_length)
    }

    pub fn send_source_code_analysis_request_sized<T: io::Read + Send + 'static>(
        &self,
        source_code: T,
        source_code_size: u64,
    ) -> Result<u64, Box<dyn Error>> {
        let endpoint_url = self.server_addr.join("/api/analyze-code")?;
        self.send_analysis_request(
            endpoint_url,
            "text/javascript",
            source_code,
            source_code_size,
        )
    }

    pub fn send_tar_analysis_request_sized<T: io::Read + Send + 'static>(
        &self,
        tar_archive: T,
        tar_archive_size: u64,
    ) -> Result<u64, Box<dyn Error>> {
        let endpoint_url = self.server_addr.join("/api/analyze-tar")?;
        self.send_analysis_request(
            endpoint_url,
            "application/x-tar",
            tar_archive,
            tar_archive_size,
        )
    }

    fn send_analysis_request<T: io::Read + Send + 'static>(
        &self,
        endpoint_url: url::Url,
        content_type: &str,
        payload: T,
        payload_size: u64,
    ) -> Result<u64, Box<dyn Error>> {
        use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct ServerResponseData {
            job_id: Option<u64>,
            error: Option<String>,
        }

        let mut headers = HeaderMap::new();
        headers.insert("X-API-Token", HeaderValue::from_str(&self.token)?);
        headers.insert(CONTENT_TYPE, HeaderValue::from_str(content_type)?);

        let resp = self
            .http_client
            .post(endpoint_url.clone())
            .headers(headers)
            .body(reqwest::blocking::Body::sized(payload, payload_size))
            .send()?;

        let resp_status = resp.status().as_u16();
        let resp_body_bytes = resp.bytes()?;
        let resp_data: serde_json::Result<ServerResponseData> =
            serde_json::from_slice(&resp_body_bytes);

        if resp_status != 200 {
            match resp_data {
                Ok(data) => {
                    let error_message = match data.error {
                        Some(msg) => msg,
                        None => String::new(),
                    };
                    return Err(Box::new(errors::RelwarcAPIError {
                        endpoint_url: endpoint_url.into(),
                        status: resp_status,
                        error_message: error_message,
                    }));
                }
                Err(_) => {
                    return Err(Box::new(errors::RelwarcAPIError {
                        endpoint_url: endpoint_url.into(),
                        status: resp_status,
                        error_message: String::from_utf8_lossy(&resp_body_bytes).to_string(),
                    }))
                }
            }
        }
        resp_data?.job_id.ok_or(Box::new(errors::RelwarcAPIError {
            endpoint_url: endpoint_url.into(),
            status: resp_status,
            error_message: String::from("missing job_id in server response"),
        }))
    }

    pub fn websocket_watch_job<F>(&self, job_id: u64, mut cb: F) -> Result<(), Box<dyn Error>>
    where
        F: FnMut(Box<JobStatusMsg>) -> Result<bool, Box<dyn Error>>,
    {
        use serde::Serialize;
        use tungstenite::handshake::client::generate_key;
        use tungstenite::http::Request;
        use tungstenite::Message;

        #[derive(Serialize)]
        struct ClientHello<'a> {
            token: &'a str,
            job_id: u64,
        }

        let req = Request::builder()
            .uri(self.ws_url.as_ref())
            .header("Host", self.ws_url.host_str().unwrap())
            .header("Origin", &self.server_origin)
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", generate_key())
            .body(())?;
        let (mut socket, _) = tungstenite::client::connect(req)?;

        socket.send(Message::Text(
            serde_json::to_string(&ClientHello {
                token: &self.token,
                job_id,
            })?
            .into(),
        ))?;
        loop {
            let msg = socket.read()?;
            match msg {
                Message::Text(text) => {
                    let status_msg: JobStatusMsg = serde_json::from_str(text.as_str())?;
                    let msg_is_final =
                        status_msg.r#type == "result" || status_msg.r#type == "error";
                    let should_stop = cb(Box::new(status_msg))?;
                    if should_stop || msg_is_final {
                        break;
                    }
                }
                Message::Ping(bytes) => socket.send(Message::Pong(bytes))?,
                Message::Pong(_) => {}
                _ => panic!("unexpected"),
            }
        }
        socket.close(None)?;
        Ok(())
    }

    pub fn websocket_wait_for_job(&self, job_id: u64) -> Result<Box<JobStatusMsg>, Box<dyn Error>> {
        let mut last_msg: Option<Box<JobStatusMsg>> = None;

        self.websocket_watch_job(
            job_id,
            |msg: Box<JobStatusMsg>| -> Result<bool, Box<dyn Error>> {
                last_msg = Some(msg);
                Ok(false)
            },
        )?;
        match last_msg {
            Some(msg) => Ok(msg),
            None => Err(Box::new(errors::RelwarcJobError {
                job_id,
                error_message: String::from("Server sent no messages"),
            })),
        }
    }

    pub fn websocket_wait_for_job_result(
        &self,
        job_id: u64,
    ) -> Result<AnalysisResult, Box<dyn Error>> {
        let msg = self.websocket_wait_for_job(job_id)?;

        match msg.r#type.as_str() {
            "result" => msg.result.ok_or(Box::new(errors::RelwarcJobError {
                job_id,
                error_message: String::from("result message lacks a 'result' field"),
            })),
            "error" => Err(Box::new(errors::RelwarcJobError {
                job_id,
                error_message: msg.message.unwrap_or(String::new()),
            })),
            _ => Err(Box::new(errors::RelwarcJobError {
                job_id,
                error_message: "Unexpected message type: ".to_owned() + &msg.r#type,
            })),
        }
    }
}

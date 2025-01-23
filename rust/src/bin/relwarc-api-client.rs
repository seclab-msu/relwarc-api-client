use clap::{value_parser, Arg, Command};
use std::fs;
use std::io;
use std::path::PathBuf;

use relwarc_api_client::{AnalysisResult, RelwarcAPIClient, DEFAULT_SERVER_ADDR};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matches = Command::new("relwarc-api-client")
        .arg(
            Arg::new("server-addr")
                .long("server-addr")
                .required(false)
                .default_value(DEFAULT_SERVER_ADDR)
                .value_parser(value_parser!(url::Url)),
        )
        .arg(Arg::new("api-token").long("api-token").required(true))
        .arg_required_else_help(true)
        .subcommand_required(true)
        .subcommand(
            Command::new("analyze-source-file").arg(
                Arg::new("file_path")
                    .value_parser(value_parser!(PathBuf))
                    .required(true),
            ),
        )
        .subcommand(Command::new("analyze-url").arg(Arg::new("page_url").required(true)))
        .subcommand(
            Command::new("analyze-tar").arg(
                Arg::new("tar_path")
                    .value_parser(value_parser!(PathBuf))
                    .required(true),
            ),
        )
        .get_matches();

    let server_addr = matches
        .get_one::<url::Url>("server-addr")
        .expect("server-addr has a default value");
    let api_token = matches
        .get_one::<String>("api-token")
        .expect("api-token is a required arg");

    let client = RelwarcAPIClient::new_for_server(api_token.clone(), server_addr.as_str())?;

    let result: AnalysisResult;

    if let Some(matches) = matches.subcommand_matches("analyze-source-file") {
        let filename = matches
            .get_one::<PathBuf>("file_path")
            .expect("file_path is required");
        result = client.analyze_source_code(fs::File::open(filename)?)?;
    } else if let Some(matches) = matches.subcommand_matches("analyze-url") {
        let page_url = matches
            .get_one::<String>("page_url")
            .expect("page_url is required");
        result = client.analyze_page_url(page_url.clone())?;
    } else if let Some(matches) = matches.subcommand_matches("analyze-tar") {
        let filename = matches
            .get_one::<PathBuf>("tar_path")
            .expect("tar_path is required");
        result = client.analyze_page_tar(fs::File::open(filename)?)?;
    } else {
        unreachable!("HUI");
    }

    Ok(serde_json::to_writer(io::stdout(), &result)?)
}

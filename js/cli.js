#!/usr/bin/env node

const fs = require('fs');

const { ArgumentParser } = require('argparse');

const { RelwarcAPIClient } = require('./relwarc');


const parser = new ArgumentParser({
    description: 'Relwarc API client'
});

parser.add_argument('--server-addr', { default: undefined });
parser.add_argument('--api-token', { required: true });

const subparsers = parser.add_subparsers({
    title: 'commands',
    dest: 'command',
    required: true
});

const analyzeSourceParser = subparsers.add_parser('analyze-source-file', {
    help: 'Analyze JavaScript source code file'
});
analyzeSourceParser.add_argument('source_file', {
    help: 'Path to JavaScript source file to analyze'
});

const analyzeUrlParser = subparsers.add_parser('analyze-url', {
    help: 'Analyze page given by URL'
});
analyzeUrlParser.add_argument('url', {
    help: 'URL to analyze'
});

const analyzeTarParser = subparsers.add_parser('analyze-tar', {
    help: 'Analyze page packed as a TAR archive'
});
analyzeTarParser.add_argument('tar_file', {
    help: 'Path to tar archive to analyze'
});

const args = parser.parse_args();

const client = new RelwarcAPIClient(args.api_token, args.server_addr);

(async () => {
    let result;
    switch (args.command) {
        case 'analyze-source-file':
            const sourceCode = await fs.promises.readFile(args.source_file, 'utf8');
            result = await client.analyzeSourceCode(sourceCode);
            break;
        case 'analyze-url':
            result = await client.analyzePageURL(args.url);
            break;
        case 'analyze-tar':
            const tarData = await fs.promises.readFile(args.tar_file);
            result = await client.analyzePageTar(tarData);
            break;
        default:
            throw new Error(`Unknown command: ${args.command}`);
    }
    console.log(JSON.stringify(result));
})();

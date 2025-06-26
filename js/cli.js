#!/usr/bin/env node

const fs = require('fs');
const stream = require('stream');

const { ArgumentParser } = require('argparse');

const { RelwarcAPIClient } = require('./relwarc');
const { createPageTar } = require('./page-tar');

function createClient(args) {
    if (args.command !== 'make-page-tar') {
        if (!args.api_token) {
            console.error(`API token is required (add "--api-token TOKEN" before command)`);
            process.exit(1);
        }
        let verbose = !args.q;
        return new RelwarcAPIClient(args.api_token, args.server_addr, verbose);
    }
    return null;
}

async function makePageTar(url, tarFilePath) {
    const tarFile = fs.createWriteStream(tarFilePath);
    await createPageTar(url, tarFile);
    tarFile.close();
}

async function createPageTarAndSendToAnalyzer(pageUrl, saveTo, client) {
    const pipe = new stream.PassThrough();
    let output = stream.Readable.toWeb(pipe);
    let tarFileStream;
    if (typeof saveTo === 'string' && saveTo.length > 0) {
        const [copy1, copy2] = output.tee();
        tarFileStream = fs.createWriteStream(saveTo);
        output = copy1;
        stream.Readable.fromWeb(copy2).pipe(tarFileStream);
    }
    const pageTarMade = createPageTar(pageUrl, pipe);
    const analysisResult = client.analyzePageTar(output);
    const resultValues = await Promise.all([analysisResult, pageTarMade]);
    if (tarFileStream) {
        tarFileStream.close();
    }
    return resultValues[0];
}

const parser = new ArgumentParser({
    description: 'Relwarc API client'
});

parser.add_argument('--server-addr', { default: undefined });
parser.add_argument('--api-token', { default: null });
parser.add_argument('-q', { action: 'store_true', help: 'Hide analyzer logs and don\'t print job IDs' });

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
analyzeTarParser.add_argument('--tar-file', {
    help: 'Path to tar archive to analyze'
});
analyzeTarParser.add_argument('--page-url', {
    help: 'URL of the page to pack and send to the analyzer'
});
analyzeTarParser.add_argument('--save-to', {
    help: 'Save the created tar copy of the page to this path'
});

const makeTarParser = subparsers.add_parser('make-page-tar', {
    help: 'Make a local copy of the page packed as a TAR archive'
});
makeTarParser.add_argument('url', {
    help: 'URL of the page that should be copied'
});
makeTarParser.add_argument('tar_file', {
    help: 'Path to resulting tar'
});

const args = parser.parse_args();

const client = createClient(args);

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
            if (args.tar_file && args.page_url) {
                console.error('--tar-file and --page-url are mutually exclusive');
                process.exit(1);
            }
            if (args.tar_file) {
                const tarData = await fs.promises.readFile(args.tar_file);
                result = await client.analyzePageTar(tarData);
            } else {
                if (!args.page_url) {
                    console.error('either --tar-file or --page-url is required');
                    process.exit(1);
                }
                result = await createPageTarAndSendToAnalyzer(args.page_url, args.save_to, client);
            }
            break;
        case 'make-page-tar':
            result = await makePageTar(args.url, args.tar_file);
            break;
        default:
            throw new Error(`Unknown command: ${args.command}`);
    }
    if (args.command !== 'make-page-tar') {
        console.log(JSON.stringify(result));
    }
})();

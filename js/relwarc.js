WebSocket = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');

const DEFAULT_SERVER_ADDR = 'https://relwarc.solidpoint.net';


class RelwarcAPIClient {
    token
    serverAddr
    wsURL
    verbose
    constructor(apiToken, serverAddr=DEFAULT_SERVER_ADDR, verbose=true) {
        this.token = apiToken;
        this.serverAddr = serverAddr;
        const wsURL = new URL('/api/job/watch', serverAddr);
        wsURL.protocol = wsURL.protocol.replace('http', 'ws');
        this.wsURL = wsURL;
        this.verbose = verbose;
    }

    async analyzeSourceCode(sourceCode) {
        const jobID = await this.sendSourceCodeAnalysisRequest(sourceCode);
        return await this.websocketWaitForJobResult(jobID);
    }

    async analyzePageURL(pageURL) {
        const jobID = await this.sendPageAnalysisRequest(pageURL);
        return await this.websocketWaitForJobResult(jobID);
    }

    async analyzePageTar(tarFile) {
        const jobId = await this.sendTarAnalysisRequest(tarFile);
        return await this.websocketWaitForJobResult(jobId);
    }

    async sendPageAnalysisRequest(pageUrl) {
        const endpointURL = new URL('/api/analyze-url', this.serverAddr);
        return await this.#sendAnalysisRequest(endpointURL, 'text/plain', pageUrl);
    }

    async sendSourceCodeAnalysisRequest(sourceCode) {
        const endpointURL = new URL('/api/analyze-code', this.serverAddr);
        return await this.#sendAnalysisRequest(endpointURL, 'text/javascript', sourceCode);
    }

    async sendTarAnalysisRequest(tarArchive) {
        const endpointURL = new URL('/api/analyze-tar', this.serverAddr);
        return await this.#sendAnalysisRequest(endpointURL, 'application/x-tar', tarArchive);
    }

    async #sendAnalysisRequest(endpointURL, contentType, payload) {
        const options = {
            method: 'POST',
            headers: {
                'X-API-Token': this.token,
                'Content-Type': contentType
            },
            body: payload
        };
        if (payload instanceof ReadableStream) {
            options.duplex = 'half';
        }
        const response = await fetch(endpointURL, options);

        if (!response.ok) {
            let errMsg;
            const responseText = await response.text();
            try {
                errMsg = JSON.parse(responseText).error;
            } catch {
                errMsg = responseText;
            }
            throw new RelwarcAPIError(endpointURL, response.status, errMsg);
        }
        const jobID = (await response.json()).job_id;
        if (this.verbose) {
            console.error('analysis request sent, jobID:', jobID);
        }
        return jobID;
    }

    async websocketWatchJob(jobId, msgCallback) {
        // note: server may reject the connection in case of missing or untrusted 'Origin:'
        let options = undefined;
        if (WebSocket.length > 1) {
            options = { origin: new URL(this.serverAddr).origin };
        } else if (!(WebSocket + '').includes('[native code]')) {
            options = { headers: { Origin: new URL(this.serverAddr).origin } };
        }
        const ws = new WebSocket(this.wsURL, options);

        let doneCallback, errCallback;

        const jobDone = new Promise((resolve, reject) => {
            doneCallback = resolve;
            errCallback = reject;
        });

        ws.onmessage = (messageEvent) => {
            try {
                const data = JSON.parse(messageEvent.data);
                const shouldStop = msgCallback(data);
                if (shouldStop) {
                    doneCallback();
                    return;
                }
                if (data.type === 'result' || data.type === 'error') {
                    doneCallback();
                } else if (this.verbose) {
                    console.error('analyzer:', data.type, data.message);
                }
            } catch (err) {
                errCallback(err);
                return;
            }
        };

        ws.onopen = () => {
            ws.send(JSON.stringify({ token: this.token, job_id: jobId }));
        };
        ws.onerror = err => {
            errCallback(err.error ? err.error : err);
        };
        ws.onclose = () => {
            doneCallback();
        };
        try {
            await jobDone;
        } finally {
            ws.close();
        }
    }

    async websocketWaitForJob(jobId) {
        let lastMsg = null;
        await this.websocketWatchJob(jobId, (msg) => {
            lastMsg = msg;
            return false;
        });
        return lastMsg;
    }

    async websocketWaitForJobResult(jobId) {
        const lastMsg = await this.websocketWaitForJob(jobId);
        const type = lastMsg.type;
        if (type === 'result') {
            return lastMsg.result;
        } else if (type === 'error') {
            throw new RelwarcJobError(jobId, lastMsg.message);
        } else {
            throw new Error(`Unexpected message type ${type} (${JSON.stringify(lastMsg)})`);
        }
    }
}


class RelwarcAPIError extends Error {
    constructor(endpointURL, status, errorMessage) {
        super(`Relwarc API endpoint ${endpointURL} responded with status ${status}: ${errorMessage}`);
        this.endpointURL = endpointURL;
        this.status = status;
        this.errorMessage = errorMessage;
    }
}

class RelwarcJobError extends Error {
    constructor(jobID, msg) {
        super(`Relwarc failed to execute job ${jobID}, error msg is: ${msg}`);
        this.jobID = jobID;
        this.msg = msg;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RelwarcAPIClient;
    module.exports.RelwarcAPIClient = RelwarcAPIClient;
    module.exports.RelwarcAPIError = RelwarcAPIError;
    module.exports.RelwarcJobError = RelwarcJobError;
    module.exports.DEFAULT_SERVER_ADDR = DEFAULT_SERVER_ADDR;
}

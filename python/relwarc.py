import json
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
import websockets.sync.client

DEFAULT_SERVER_ADDR = 'https://relwarc.solidpoint.net'

class RelwarcAPIError(Exception):
    def __init__(self, endpoint_url, status, msg):
        self.endpoint_url = endpoint_url
        self.status = status
        self.error_message = msg

        message = f'Relwarc API endpoint {endpoint_url} responded with status {status}: {msg}'

        super().__init__(message)

class RelwarcJobError(Exception):
    def __init__(self, job_id, msg):
        self.job_id = job_id
        self.error_message = msg

        message = f'Relwarc failed to execute job {job_id}, error msg is: {msg}'

        super().__init__(message)

class RelwarcAPIClient:
    def __init__(self, api_token, server_addr=DEFAULT_SERVER_ADDR):
        self.token = api_token
        self.server_addr = server_addr
        self.server_origin = self.origin_from_url(server_addr)
        pu = urlparse(server_addr)
        ws_server_addr = pu._replace(scheme=pu.scheme.replace('http', 'ws')).geturl()
        self.ws_url = urljoin(ws_server_addr, '/api/job/watch')

    def analyze_source_code(self, source_code):
        job_id = self.send_source_code_analysis_request(source_code)
        return self.websocket_wait_for_job_result(job_id)

    def analyze_page_url(self, page_url):
        job_id = self.send_page_analysis_request(page_url)
        return self.websocket_wait_for_job_result(job_id)

    def analyze_page_tar(self, tar_file):
        if isinstance(tar_file, (str, Path)):
            with open(tar_file, 'rb') as f:
                job_id = self.send_tar_analysis_request(f)
        else:
            job_id = self.send_tar_analysis_request(tar_file)
        return self.websocket_wait_for_job_result(job_id)

    def send_page_analysis_request(self, page_url):
        endpoint_url = urljoin(self.server_addr, '/api/analyze-url')
        return self._send_analysis_request(endpoint_url, 'text/plain', page_url)

    def send_source_code_analysis_request(self, source_code):
        endpoint_url = urljoin(self.server_addr, '/api/analyze-code')
        return self._send_analysis_request(endpoint_url, 'text/javascript', source_code)

    def send_tar_analysis_request(self, tar_archive):
        endpoint_url = urljoin(self.server_addr, '/api/analyze-tar')
        return self._send_analysis_request(endpoint_url, 'application/x-tar', tar_archive)

    def _send_analysis_request(self, endpoint_url, content_type, payload):
        resp = requests.post(
            endpoint_url,
            headers={
                'X-API-Token': self.token,
                'Content-Type': content_type
            },
            data=payload
        )
        if resp.status_code != 200:
            try:
                err_msg = resp.json()['error']
            except requests.exceptions.JSONDecodeError:
                err_msg = resp.text
            raise RelwarcAPIError(endpoint_url, resp.status_code, err_msg)
        return resp.json()['job_id']

    def websocket_watch_job(self, job_id):
        # note: server may reject the connection in case of missing or untrusted 'Origin:'
        headers = { 'Origin': self.server_origin }
        with websockets.sync.client.connect(self.ws_url, additional_headers=headers) as ws:
            ws.send(json.dumps({ "token": self.token, "job_id": job_id }))
            while True:
                data = json.loads(ws.recv())
                yield data
                if data['type'] == 'result' or data['type'] == 'error':
                    break

    def websocket_wait_for_job(self, job_id):
        last_msg = None
        for msg in self.websocket_watch_job(job_id):
            last_msg = msg
        return last_msg

    def websocket_wait_for_job_result(self, job_id):
        last_msg = self.websocket_wait_for_job(job_id)
        t = last_msg['type']
        if t == 'result':
            return last_msg['result']
        elif t == 'error':
            raise RelwarcJobError(job_id, last_msg['message'])
        else:
            raise Exception(f'Unexpected message type {t} ({str(last_msg)})')

    @staticmethod
    def origin_from_url(url):
        parsed = urlparse(url)
        origin = f'{parsed.scheme}://{parsed.netloc}'

        if parsed.scheme == 'http' and origin.endswith(':80'):
            origin = origin[:-3]
        elif parsed.scheme == 'https' and origin.endswith(':443'):
            origin = origin[:-4]

        return origin

if __name__ == '__main__':
    import argparse, sys

    argparser = argparse.ArgumentParser(
        prog='Relwarc API Client'
    )

    argparser.add_argument('--server-addr', default=DEFAULT_SERVER_ADDR)
    argparser.add_argument('--api-token', required=True)


    subparsers = argparser.add_subparsers(dest='mode', required=True)

    parser_url = subparsers.add_parser('analyze-url')
    parser_url.add_argument('url')
    parser_source = subparsers.add_parser('analyze-source-file')
    parser_source.add_argument('source-file', type=argparse.FileType('r', encoding='UTF-8'))
    parser_tar = subparsers.add_parser('analyze-tar')
    parser_tar.add_argument('tar-file', type=argparse.FileType('rb'))

    args = argparser.parse_args()

    relwarc = RelwarcAPIClient(args.api_token, args.server_addr)

    if args.mode == 'analyze-source-file':
        results = relwarc.analyze_source_code(getattr(args, 'source-file'))
    elif args.mode == 'analyze-url':
        results = relwarc.analyze_page_url(args.url)
    elif args.mode == 'analyze-tar':
        results = relwarc.analyze_page_tar(getattr(args, 'tar-file'))
    else:
        raise Exception("Unexpected mode: " + args.mode)
    json.dump(results, sys.stdout)

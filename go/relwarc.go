package relwarc

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const DefaultServerAddr = "https://relwarc.solidpoint.net"

type RelwarcAPIClient struct {
	Token        string
	serverAddr   string
	serverOrigin string
	wsURL        string
}

func NewRelwarcAPIClient(apiToken string) *RelwarcAPIClient {
	c, err := NewRelwarcAPIClientForServer(apiToken, DefaultServerAddr)
	if err != nil {
		panic(err)
	}
	return c
}

func NewRelwarcAPIClientForServer(apiToken string, serverAddr string) (*RelwarcAPIClient, error) {
	u, err := url.Parse(serverAddr)
	if err != nil {
		return nil, err
	}
	origin := u.Scheme + "://" + u.Host
	u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	u.Path, err = url.JoinPath(u.Path, "/api/job/watch")
	if err != nil {
		return nil, err
	}
	return &RelwarcAPIClient{
		Token:        apiToken,
		serverAddr:   serverAddr,
		serverOrigin: origin,
		wsURL:        u.String(),
	}, nil
}

func (c *RelwarcAPIClient) AnalyzeSourceCode(sourceCode io.Reader) (AnalysisResult, error) {
	jobID, err := c.SendSourceCodeAnalysisRequest(sourceCode)
	if err != nil {
		return nil, err
	}
	return c.WebsocketWaitForJobResult(jobID)
}

func (c *RelwarcAPIClient) AnalyzePageURL(pageURL string) (AnalysisResult, error) {
	jobID, err := c.SendPageAnalysisRequest(pageURL)
	if err != nil {
		return nil, err
	}
	return c.WebsocketWaitForJobResult(jobID)

}

func (c *RelwarcAPIClient) AnalyzePageTAR(tarArchive io.Reader) (AnalysisResult, error) {
	jobID, err := c.SendTARAnalysisRequest(tarArchive)
	if err != nil {
		return nil, err
	}
	return c.WebsocketWaitForJobResult(jobID)
}

func (c *RelwarcAPIClient) SendPageAnalysisRequest(pageURL string) (uint64, error) {
	endpointURL, err := url.JoinPath(c.serverAddr, "/api/analyze-url")
	if err != nil {
		return 0, err
	}
	return c.sendAnalysisRequest(endpointURL, "text/plain", strings.NewReader(pageURL))
}

func (c *RelwarcAPIClient) SendSourceCodeAnalysisRequest(sourceCode io.Reader) (uint64, error) {
	endpointURL, err := url.JoinPath(c.serverAddr, "/api/analyze-code")
	if err != nil {
		return 0, err
	}
	return c.sendAnalysisRequest(endpointURL, "text/javascript", sourceCode)
}

func (c *RelwarcAPIClient) SendTARAnalysisRequest(tarArchive io.Reader) (uint64, error) {
	endpointURL, err := url.JoinPath(c.serverAddr, "/api/analyze-tar")
	if err != nil {
		return 0, err
	}
	return c.sendAnalysisRequest(endpointURL, "application/x-tar", tarArchive)
}

func (c *RelwarcAPIClient) sendAnalysisRequest(endpointURL string, contentType string, payload io.Reader) (uint64, error) {
	type serverResponseData struct {
		JobID uint64 `json:"job_id"`
		Error string `json:"error"`
	}

	var (
		req *http.Request
		err error
	)

	switch payload.(type) {
	case *bytes.Buffer, *bytes.Reader, *strings.Reader:
		req, err = http.NewRequest("POST", endpointURL, payload)
		if err != nil {
			return 0, err
		}
	default:
		body, length, err := determineLength(payload)
		if err != nil {
			return 0, err
		}
		if length == 0 {
			body = nil
		}
		req, err = http.NewRequest("POST", endpointURL, body)
		if err != nil {
			return 0, err
		}
		req.ContentLength = length
	}

	req.Header.Set("X-API-Token", c.Token)
	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)

	if err != nil {
		return 0, err
	}

	defer resp.Body.Close()

	respBodyBytes, err := io.ReadAll(resp.Body)

	if err != nil {
		return 0, err
	}

	var respData serverResponseData

	jsonUnmarshalError := json.Unmarshal(respBodyBytes, &respData)

	if resp.StatusCode == 200 {
		return respData.JobID, jsonUnmarshalError
	}

	var errorMsg string
	if jsonUnmarshalError == nil {
		errorMsg = respData.Error
	} else {
		errorMsg = string(respBodyBytes)
	}
	return 0, &RelwarcAPIError{
		EndpointURL:  endpointURL,
		Status:       resp.StatusCode,
		ErrorMessage: errorMsg,
	}
}

func (c *RelwarcAPIClient) WebsocketWatchJob(jobID uint64, msgCallback func(*JobStatusMsg) (bool, error)) error {
	type clientHello struct {
		Token string `json:"token"`
		JobID uint64 `json:"job_id"`
	}
	conn, _, err := websocket.DefaultDialer.Dial(c.wsURL, http.Header{
		"Origin": []string{c.serverOrigin},
	})

	if err != nil {
		return err
	}

	defer conn.Close()

	err = conn.WriteJSON(&clientHello{Token: c.Token, JobID: jobID})
	if err != nil {
		return err
	}

	var msg JobStatusMsg

	for {
		err = conn.ReadJSON(&msg)
		if err != nil {
			return err
		}
		shouldStop, err := msgCallback(&msg)
		if err != nil || shouldStop {
			return err
		}
		if msg.Type == "result" || msg.Type == "error" {
			return nil
		}
	}
}

func (c *RelwarcAPIClient) WebsocketWaitForJob(jobID uint64) (*JobStatusMsg, error) {
	var lastMsg *JobStatusMsg
	err := c.WebsocketWatchJob(jobID, func(msg *JobStatusMsg) (bool, error) {
		lastMsg = msg
		return false, nil
	})
	return lastMsg, err
}

func (c *RelwarcAPIClient) WebsocketWaitForJobResult(jobID uint64) (AnalysisResult, error) {
	msg, err := c.WebsocketWaitForJob(jobID)

	if err != nil {
		return nil, err
	}

	switch msg.Type {
	case "result":
		return msg.Result, nil
	case "error":
		return nil, &RelwarcJobError{JobID: jobID, ErrorMessage: msg.Message}
	default:
		return nil, errors.New("Unexpected message type: " + msg.Type)
	}
}
